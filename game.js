// ============================================================
// Retro Ball - a simplified arcade football sim
// ============================================================

// ---------- PWA install support ----------
// Only takes effect once the game is actually served over http(s) (e.g. via
// GitHub Pages) - service workers aren't available on file:// pages at all,
// so this silently no-ops there without breaking anything.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline/installability just won't be available */ });
  });
}

// ---------- Pitch geometry (real proportions, in metres) ----------
const PITCH_LEN = 105;
const PITCH_WID = 68;
const SCALE = 10;           // pixels per metre
const MARGIN = 40;          // canvas margin around the pitch
const GOAL_WIDTH = 7.32;
const BOX_DEPTH = 16.5;
const BOX_WIDTH = 40.32;
const SIX_DEPTH = 5.5;
const SIX_WIDTH = 18.32;
const CENTER_CIRCLE_R = 9.15;
const PEN_SPOT_DIST = 11;
const CENTER_POS = { x: PITCH_LEN / 2, y: PITCH_WID / 2 };
const CANVAS_W = PITCH_LEN * SCALE + MARGIN * 2; // matches the canvas's width attribute in index.html
const CANVAS_H = PITCH_WID * SCALE + MARGIN * 2; // matches the canvas's height attribute in index.html

function toCanvasX(xm) { return MARGIN + xm * SCALE; }
function toCanvasY(ym) { return MARGIN + ym * SCALE; }

// ---------- High-DPI canvas backing store ----------
// The canvas's CSS size is set responsively (see #pitch in style.css); this
// keeps its actual pixel resolution matched to the screen's device pixel
// ratio so lines/circles stay crisp on retina phones and laptops instead of
// being upscaled and blurred. render() re-applies the matching ctx.scale
// every frame, so all the toCanvasX/toCanvasY logic above is untouched.
let canvasDPR = 1;
function setupCanvasDPI() {
  const canvas = document.getElementById('pitch');
  const dpr = window.devicePixelRatio || 1;
  if (dpr === canvasDPR && canvas.width === CANVAS_W * dpr) return;
  canvasDPR = dpr;
  canvas.width = CANVAS_W * dpr;
  canvas.height = CANVAS_H * dpr;
}

// ---------- Fullscreen ----------
// Best-effort only: iOS Safari in particular doesn't support fullscreening
// an arbitrary element, so this silently does nothing there.
function requestFullscreenNow() {
  const el = document.documentElement;
  const request = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!request) return;
  try {
    const result = request.call(el);
    if (result && result.catch) result.catch(() => {});
  } catch (e) { /* fullscreen unavailable or denied - just stay windowed */ }
}
function exitFullscreenIfActive() {
  if (!document.fullscreenElement) return;
  const exit = document.exitFullscreen || document.webkitExitFullscreen;
  if (!exit) return;
  try {
    const result = exit.call(document);
    if (result && result.catch) result.catch(() => {});
  } catch (e) { /* nothing to do if this fails */ }
}
// Auto-fullscreen on match start, mobile only - desktop is left alone there
// since the browser chrome isn't eating into a phone-sized viewport.
function requestMobileFullscreen() {
  if (!window.matchMedia('(pointer: coarse)').matches) return;
  requestFullscreenNow();
}
// The main menu's manual fullscreen button - available on any device,
// desktop included, since some players just want the whole browser window
// out of the way rather than only ever getting it automatically at kickoff.
function toggleFullscreen() {
  if (document.fullscreenElement) exitFullscreenIfActive();
  else requestFullscreenNow();
}

// ---------- Teams (2025-26 Premier League lineup, approximate kit colours) ----------
// `strength` is a rough, subjective approximation of each club's current
// overall quality (not real statistics) - it biases that team's players'
// attributes up or down around the default 1.0 baseline.
// `away` is a plausible (not verified against any current real kit) alternate
// strip, picked to contrast with the home strip - used when it and the other
// side's home kit are too close in colour to tell apart at a glance (see
// kitsClash below).
// `press` is a rough, subjective read on each club's real-world tactical
// identity ('high'/'mid'/'low') - see PRESS_STYLES below for what it actually
// changes: how far up the pitch the team holds its shape without the ball,
// and how many players close down the ball carrier.
// `squad` (only used for whichever team the human actually plays as - see
// assignRealNames) is a rough, recognisable roster bucketed into this game's
// four groups (GK/DEF/MID/FWD), not an exact real-world formation. Real
// squads change constantly through transfer windows, so treat these as
// flavour rather than a guaranteed up-to-date roster - easy to hand-edit
// per club if a name's gone stale.
const TEAMS = [
  { name: 'Arsenal', shirt: '#EF0107', shorts: '#FFFFFF', strength: 1.16, press: 'high', away: { shirt: '#132257', shorts: '#FFFFFF' },
    squad: {
      GK: ['David Raya', 'Kepa Arrizabalaga', 'Tommy Setford'],
      DEF: ['William Saliba', 'Gabriel Magalhães', 'Jurriën Timber', 'Ben White', 'Riccardo Calafiori', 'Jakub Kiwior', 'Myles Lewis-Skelly', 'Cristhian Mosquera', 'Piero Hincapié'],
      MID: ['Declan Rice', 'Martin Ødegaard', 'Martín Zubimendi', 'Mikel Merino', 'Fabio Vieira', 'Ethan Nwaneri', 'Charlie Patino'],
      FWD: ['Bukayo Saka', 'Gabriel Martinelli', 'Kai Havertz', 'Gabriel Jesus', 'Leandro Trossard', 'Reiss Nelson'],
    } },
  { name: 'Aston Villa', shirt: '#670E36', shorts: '#95BFE5', strength: 1.02, press: 'mid', away: { shirt: '#FFFFFF', shorts: '#000000' },
    squad: {
      GK: ['Emiliano Martínez', 'Robin Olsen', 'Marco Bizot'],
      DEF: ['Ezri Konsa', 'Pau Torres', 'Lucas Digne', 'Matty Cash', 'Tyrone Mings', 'Ian Maatsen', 'Victor Lindelöf', 'Kosta Nedeljković'],
      MID: ['Youri Tielemans', 'John McGinn', 'Boubacar Kamara', 'Amadou Onana', 'Morgan Rogers', 'Ross Barkley'],
      FWD: ['Ollie Watkins', 'Donyell Malen', 'Leon Bailey', 'Emiliano Buendía', 'Evann Guessand', 'Kaine Kesler-Hayden'],
    } },
  { name: 'Bournemouth', shirt: '#DA291C', shorts: '#000000', strength: 0.96, press: 'high', away: { shirt: '#FFFFFF', shorts: '#1D4289' },
    squad: {
      GK: ['Norberto Neto', 'Mark Travers', 'Will Dennis'],
      DEF: ['Illia Zabarnyi', 'Marcos Senesi', 'Adam Smith', 'Bafodé Diakité', 'Julián Araujo', 'Álex Jiménez', 'Ryan Fredericks', 'James Hill'],
      MID: ['Ryan Christie', 'Alex Scott', 'Tyler Adams', 'David Brooks', 'Ben Pearson', 'Philip Billing'],
      FWD: ['Antoine Semenyo', 'Evanilson', 'Dango Ouattara', 'Enes Ünal', 'Justin Kluivert', 'Eli Junior Kroupi'],
    } },
  { name: 'Brentford', shirt: '#E30613', shorts: '#000000', strength: 0.97, press: 'mid', away: { shirt: '#FFFFFF', shorts: '#1D4289' },
    squad: {
      GK: ['Mark Flekken', 'Thomas Strakosha', 'Hákon Rafn Valdimarsson'],
      DEF: ['Nathan Collins', 'Ethan Pinnock', 'Rico Henry', 'Sepp van den Berg', 'Aaron Hickey', 'Kristoffer Ajer', 'Ben Mee', 'Michael Kayode'],
      MID: ['Christian Nørgaard', 'Mathias Jensen', 'Vitaly Janelt', 'Mikkel Damsgaard', 'Yehor Yarmoliuk'],
      FWD: ['Kevin Schade', 'Igor Thiago', 'Yoane Wissa', 'Fábio Carvalho', 'Keane Lewis-Potter', 'Gustavo Nunes'],
    } },
  { name: 'Brighton & Hove Albion', shirt: '#0057B8', shorts: '#FFFFFF', strength: 1.03, press: 'high', away: { shirt: '#1B1B3A', shorts: '#1B1B3A' },
    squad: {
      GK: ['Bart Verbruggen', 'Jason Steele', 'Tom McGill'],
      DEF: ['Lewis Dunk', 'Jan Paul van Hecke', 'Pervis Estupiñán', 'Tariq Lamptey', 'Adam Webster', 'Igor Julio', 'Diego Coppola', 'Ferdi Kadıoğlu'],
      MID: ['Carlos Baleba', 'James Milner', 'Jack Hinshelwood', "Matt O'Riley", 'Georginio Rutter', 'Yasin Ayari'],
      FWD: ['Kaoru Mitoma', 'Yankuba Minteh', 'Danny Welbeck', 'Simon Adingra', 'Evan Ferguson', 'Stefanos Tzimas'],
    } },
  { name: 'Burnley', shirt: '#6C1D45', shorts: '#FFFFFF', strength: 0.88, press: 'low', away: { shirt: '#87CEEB', shorts: '#FFFFFF' },
    squad: {
      GK: ['James Trafford', 'Vitezslav Jaros', 'Cican Stanković'],
      DEF: ['Maxime Esteve', 'Jordan Beyer', 'Hjalmar Ekdal', 'Axel Tuanzebe', 'Bashir Humphreys', 'Connor Roberts', 'Quilindschy Hartman'],
      MID: ['Josh Cullen', 'Josh Brownhill', 'Jacob Bruun Larsen', 'Manuel Benson', 'Florentino Luís'],
      FWD: ['Zian Flemming', 'Lyle Foster', 'Marcus Edwards', 'Loum Tchaouna', 'Jaidon Anthony', 'Armando Broja', 'Enock Agyei'],
    } },
  { name: 'Chelsea', shirt: '#034694', shorts: '#034694', strength: 1.10, press: 'mid', away: { shirt: '#FFD500', shorts: '#041E42' },
    squad: {
      GK: ['Robert Sánchez', 'Filip Jörgensen', 'Gaga Slonina'],
      DEF: ['Levi Colwill', 'Wesley Fofana', 'Reece James', 'Marc Cucurella', 'Malo Gusto', 'Benoît Badiashile', 'Tosin Adarabioyo', 'Josh Acheampong', 'Aarón Anselmino'],
      MID: ['Enzo Fernández', 'Moisés Caicedo', 'Romeo Lavia', 'Cole Palmer', 'Kiernan Dewsbury-Hall', 'Andrey Santos'],
      FWD: ['Nicolas Jackson', 'João Pedro', 'Pedro Neto', 'Christopher Nkunku', 'Tyrique George', 'Marc Guiu'],
    } },
  { name: 'Crystal Palace', shirt: '#C4122E', shorts: '#1B458F', strength: 1.01, press: 'low', away: { shirt: '#111111', shorts: '#111111' },
    squad: {
      GK: ['Dean Henderson', 'Remi Matthews'],
      DEF: ['Marc Guéhi', 'Maxence Lacroix', 'Tyrick Mitchell', 'Daniel Muñoz', 'Chris Richards', 'Nathaniel Clyne', 'Chadi Riad', 'Borna Sosa'],
      MID: ['Adam Wharton', 'Will Hughes', 'Cheick Doucouré', 'Jefferson Lerma', 'Romain Esse'],
      FWD: ['Jean-Philippe Mateta', 'Ismaïla Sarr', 'Yeremy Pino', 'Daichi Kamada', 'Eddie Nketiah'],
    } },
  { name: 'Everton', shirt: '#003399', shorts: '#FFFFFF', strength: 0.99, press: 'low', away: { shirt: '#F5A300', shorts: '#00193A' },
    squad: {
      GK: ['Jordan Pickford', 'João Virgínia', 'Harry Tyrer'],
      DEF: ['Jarrad Branthwaite', 'James Tarkowski', 'Vitaliy Mykolenko', "Jake O'Brien", 'Nathan Patterson', 'Michael Keane', 'Adam Aznou', 'Séamus Coleman'],
      MID: ['Idrissa Gueye', 'Abdoulaye Doucouré', 'James Garner', 'Tim Iroegbunam', 'Carlos Alcaraz', 'Merlin Röhl'],
      FWD: ['Iliman Ndiaye', 'Beto', 'Jack Harrison', 'Dwight McNeil', 'Youssef Chermiti', 'Thierno Barry'],
    } },
  { name: 'Fulham', shirt: '#FFFFFF', shorts: '#000000', strength: 1.00, press: 'mid', away: { shirt: '#00573F', shorts: '#FFFFFF' },
    squad: {
      GK: ['Bernd Leno', 'Benjamin Lecomte', 'Ivan Slonje'],
      DEF: ['Calvin Bassey', 'Joachim Andersen', 'Antonee Robinson', 'Kenny Tete', 'Issa Diop', 'Timothy Castagne', 'Ryan Sessegnon', 'Jorrel Hato'],
      MID: ['Sander Berge', 'Harrison Reed', 'Emile Smith Rowe', 'Tom Cairney', 'Sasa Lukic', 'Tyrese François'],
      FWD: ['Raúl Jiménez', 'Rodrigo Muniz', 'Alex Iwobi', 'Adama Traoré', 'Harry Wilson', 'Jay Stansfield'],
    } },
  { name: 'Leeds United', shirt: '#FFFFFF', shorts: '#1D4289', strength: 0.87, press: 'mid', away: { shirt: '#1D1D1B', shorts: '#1D1D1B' },
    squad: {
      GK: ['Illan Meslier', 'Karl Darlow', 'Alex Cairns'],
      DEF: ['Pascal Struijk', 'Joe Rodon', 'Ethan Ampadu', 'Junior Firpo', 'Jayden Bogle', 'Sam Byram', 'Gabriel Gudmundsson', 'Isaac Schmidt'],
      MID: ['Ilia Gruev', 'Ao Tanaka', 'Brenden Aaronson', 'Dan James', 'Sean Longstaff'],
      FWD: ['Joel Piroe', 'Patrick Bamford', 'Wilfried Gnonto', 'Mateo Joseph', 'Largie Ramazani', 'Noah Okafor'],
    } },
  { name: 'Liverpool', shirt: '#C8102E', shorts: '#C8102E', strength: 1.18, press: 'high', away: { shirt: '#0BA6A6', shorts: '#FFFFFF' },
    squad: {
      GK: ['Alisson Becker', 'Giorgi Mamardashvili', 'Freddie Woodman'],
      DEF: ['Virgil van Dijk', 'Ibrahima Konaté', 'Andrew Robertson', 'Jeremie Frimpong', 'Milos Kerkez', 'Conor Bradley', 'Joe Gomez', 'Giovanni Leoni'],
      MID: ['Alexis Mac Allister', 'Ryan Gravenberch', 'Dominik Szoboszlai', 'Curtis Jones', 'Wataru Endo', 'Stefan Bajčetić'],
      FWD: ['Mohamed Salah', 'Darwin Núñez', 'Cody Gakpo', 'Florian Wirtz', 'Hugo Ekitiké', 'Federico Chiesa'],
    } },
  { name: 'Manchester City', shirt: '#6CABDD', shorts: '#FFFFFF', strength: 1.20, press: 'high', away: { shirt: '#1C1C1C', shorts: '#1C1C1C' },
    squad: {
      GK: ['Gianluigi Donnarumma', 'Stefan Ortega', 'Marcus Bettinelli'],
      DEF: ['Rúben Dias', 'Joško Gvardiol', 'Nathan Aké', 'Rico Lewis', 'Abdukodir Khusanov', 'Vitor Reis', 'Rayan Aït-Nouri', 'John Stones'],
      MID: ['Rodri', 'Mateo Kovačić', 'Bernardo Silva', 'Nico González', 'Tijjani Reijnders', 'Nico O\'Reilly'],
      FWD: ['Erling Haaland', 'Phil Foden', 'Jérémy Doku', 'Omar Marmoush', 'Savinho', 'Oscar Bobb'],
    } },
  { name: 'Manchester United', shirt: '#DA291C', shorts: '#FFFFFF', strength: 1.09, press: 'mid', away: { shirt: '#0C0C0C', shorts: '#0C0C0C' },
    squad: {
      GK: ['André Onana', 'Altay Bayındır', 'Tom Heaton'],
      DEF: ['Lisandro Martínez', 'Matthijs de Ligt', 'Noussair Mazraoui', 'Diogo Dalot', 'Leny Yoro', 'Luke Shaw', 'Harry Maguire', 'Ayden Heaven'],
      MID: ['Bruno Fernandes', 'Manuel Ugarte', 'Casemiro', 'Kobbie Mainoo', 'Toby Collyer'],
      FWD: ['Bryan Mbeumo', 'Rasmus Højlund', 'Mason Mount', 'Matheus Cunha', 'Amad Diallo', 'Joshua Zirkzee'],
    } },
  { name: 'Newcastle United', shirt: '#241F20', shorts: '#241F20', strength: 1.08, press: 'high', away: { shirt: '#5B2A86', shorts: '#FFFFFF' },
    squad: {
      GK: ['Nick Pope', 'Martin Dúbravka', 'John Ruddy'],
      DEF: ['Sven Botman', 'Fabian Schär', 'Kieran Trippier', 'Dan Burn', 'Tino Livramento', 'Lewis Hall', 'Jamaal Lascelles', 'Malick Thiaw'],
      MID: ['Bruno Guimarães', 'Sandro Tonali', 'Joelinton', 'Joe Willock', 'Lewis Miley'],
      FWD: ['Alexander Isak', 'Anthony Gordon', 'Harvey Barnes', 'William Osula', 'Jacob Murphy'],
    } },
  { name: 'Nottingham Forest', shirt: '#DD0000', shorts: '#FFFFFF', strength: 1.00, press: 'low', away: { shirt: '#0C2340', shorts: '#0C2340' },
    squad: {
      GK: ['Matz Sels', 'Carlos Miguel', 'Angus Gunn'],
      DEF: ['Murillo', 'Nikola Milenković', 'Ola Aina', 'Neco Williams', 'Willy Boly', 'Morato', 'Alex Moreno'],
      MID: ['Nicolás Domínguez', 'Ibrahim Sangaré', 'Elliot Anderson', 'Douglas Luiz', 'Ryan Yates'],
      FWD: ['Chris Wood', 'Callum Hudson-Odoi', 'Anthony Elanga', 'Taiwo Awoniyi', 'Morgan Gibbs-White', 'Dan Ndoye'],
    } },
  { name: 'Sunderland', shirt: '#EB172B', shorts: '#000000', strength: 0.86, press: 'low', away: { shirt: '#FFFFFF', shorts: '#1B1464' },
    squad: {
      GK: ['Anthony Patterson', 'Simon Moore', 'Anton Baidoo'],
      DEF: ['Dan Ballard', "Luke O'Nien", 'Trai Hume', 'Dennis Cirkin', 'Aji Alese', 'Nordi Mukiele', 'Reinildo Mandava', 'Leo Hjelde'],
      MID: ['Dan Neil', 'Alan Browne', 'Chris Rigg', 'Adil Aouchiche', 'Salis Abdul Samed', 'Habib Diarra'],
      FWD: ['Wilson Isidor', 'Eliezer Mayenda', 'Romaine Mundle', 'Ian Poveda', 'Brian Brobbey', 'Chemsdine Talbi'],
    } },
  { name: 'Tottenham Hotspur', shirt: '#FFFFFF', shorts: '#132257', strength: 1.07, press: 'mid', away: { shirt: '#7A263A', shorts: '#FFFFFF' },
    squad: {
      GK: ['Guglielmo Vicario', 'Antonín Kinský', 'Brandon Austin'],
      DEF: ['Cristian Romero', 'Micky van de Ven', 'Destiny Udogie', 'Pedro Porro', 'Radu Drăgușin', 'Ben Davies', 'Kevin Danso', 'Djed Spence'],
      MID: ['Yves Bissouma', 'Rodrigo Bentancur', 'James Maddison', 'Pape Matar Sarr', 'Lucas Bergvall', 'Archie Gray'],
      FWD: ['Son Heung-min', 'Dominic Solanke', 'Brennan Johnson', 'Richarlison', 'Mathys Tel', 'Wilson Odobert'],
    } },
  { name: 'West Ham United', shirt: '#7A263A', shorts: '#1BB1E7', strength: 0.98, press: 'mid', away: { shirt: '#132257', shorts: '#FFFFFF' },
    squad: {
      GK: ['Alphonse Areola', 'Mads Hermansen', 'Lukasz Fabianski'],
      DEF: ['Max Kilman', 'Jean-Clair Todibo', 'Konstantinos Mavropanos', 'Aaron Wan-Bissaka', 'Emerson Palmieri', 'Kyle Walker-Peters', 'El Hadji Malick Diouf'],
      MID: ['Tomáš Souček', 'James Ward-Prowse', 'Guido Rodríguez', 'Mateus Fernandes', 'Andy Irving'],
      FWD: ['Jarrod Bowen', 'Lucas Paquetá', 'Niclas Füllkrug', 'Crysencio Summerville', 'Callum Marshall'],
    } },
  { name: 'Wolverhampton Wanderers', shirt: '#FDB913', shorts: '#231F20', strength: 0.95, press: 'low', away: { shirt: '#FFFFFF', shorts: '#0B1F63' },
    squad: {
      GK: ['José Sá', 'Sam Johnstone', 'Dan Bentley'],
      DEF: ['Emmanuel Agbadou', 'Yerson Mosquera', 'Ki-Jana Hoever', 'Toti Gomes', 'Santiago Bueno', 'Wesley', 'Craig Dawson'],
      MID: ['João Gomes', 'Mario Lemina', 'André', 'Boubacar Traoré', 'Ladislav Krejčí', 'Jean-Ricner Bellegarde'],
      FWD: ['Jørgen Strand Larsen', 'Hwang Hee-chan', 'Fer López', 'Tolu Arokodare'],
    } },
];

// ---------- Career Mode: additional playable leagues ----------
// Same shape as TEAMS (name/shirt/shorts/strength/press/squad) so these are
// fully playable, not just a name pool - see ALL_CLUBS below. No `away` kit
// on these (kitsClash/buildTeam already fall back to the home kit when one
// isn't set, so it's a safe thing to skip at this scale). Squad depth is
// deliberately lighter than TEAMS' Premier League entries (~15-17 names
// instead of ~20-26) given the sheer number of clubs involved - same
// training-knowledge caveat as TEAMS[i].squad, more so at this volume.
const CHAMPIONSHIP_TEAMS = [
  { name: 'Leicester City', shirt: '#003090', shorts: '#FFFFFF', strength: 1.05, press: 'mid', squad: {
    GK: ['Jakub Stolarczyk', 'Danny Ward', 'Daniel Iversen'],
    DEF: ['Wout Faes', 'Jannik Vestergaard', 'Ricardo Pereira', 'James Justin', 'Victor Kristiansen', 'Caleb Okoli', 'Josh Eyanga', 'Callum Hall'],
    MID: ['Wilfred Ndidi', 'Bilal El Khannouss', 'Hamza Choudhury', 'Oliver Skipp', 'Ben Nelson', 'Tawanda Chirewa'],
    FWD: ['Patson Daka', 'Stephy Mavididi', 'Abdul Fatawu', 'Jordan Ayew'],
  } },
  { name: 'Southampton', shirt: '#D71920', shorts: '#000000', strength: 1.03, press: 'high', squad: {
    GK: ['Alex McCarthy', 'Joe Lumley', 'Harry Lewis'],
    DEF: ['Jan Bednarek', 'Jack Stephens', 'Ryan Manning', 'Yukinari Sugawara', 'Taylor Harwood-Bellis', 'Callum Slattery', 'Leon Pascoe'],
    MID: ['Flynn Downes', 'Will Smallbone', 'Shea Charles', 'Alex Jankewitz', 'Callum Chambers'],
    FWD: ['Adam Armstrong', 'Cameron Archer', 'Ryan Fraser', 'Kamaldeen Sulemana', 'Tyler Dibling'],
  } },
  { name: 'Ipswich Town', shirt: '#0044A9', shorts: '#FFFFFF', strength: 0.98, press: 'mid', squad: {
    GK: ['Vaclav Hladky', 'Christian Walton', 'Cieran Slicker'],
    DEF: ['Cameron Burgess', 'Corrie Ndaba', "Dara O'Shea", 'Leif Davis', 'Ben Johnson', 'George Edmundson', 'Harry Clarke'],
    MID: ['Sam Morsy', 'Jens Cajuste', 'Jack Taylor', 'Massimo Luongo', 'Kalvin Phillips'],
    FWD: ['Omari Hutchinson', 'George Hirst', 'Nathan Broadhead', 'Kaya Kaya Kambi'],
  } },
  { name: 'West Bromwich Albion', shirt: '#122F67', shorts: '#FFFFFF', strength: 0.95, press: 'mid', squad: {
    GK: ['Josh Griffiths', 'Alex Palmer', 'Wes Foderingham'],
    DEF: ['Semi Ajayi', 'Kyle Bartley', 'Conor Townsend', 'Erik Pieters', 'Torbjørn Heggem', 'Cedric Kipre', 'Zac Ashworth'],
    MID: ['Jayson Molumby', 'Alex Mowatt', 'John Swift', 'Jed Wallace', 'Mikey Johnston'],
    FWD: ['Josh Maja', 'Daryl Dike', 'Grady Diangana', 'Tom Fellows', 'Devante Cole'],
  } },
  { name: 'Norwich City', shirt: '#FFF200', shorts: '#00A650', strength: 0.93, press: 'mid', squad: {
    GK: ['Angus Gunn', 'George Long', 'Archie Mair'],
    DEF: ['Grant Hanley', 'Shane Duffy', 'Bali Mumba', 'Ben Chrisene', 'Dimitris Giannoulis', 'Ollie Younger'],
    MID: ['Marcelino Núñez', 'Kenny McLean', 'Callum Doyle', 'Gabriel Sara', 'Christian Fassnacht'],
    FWD: ['Josh Sargent', 'Borja Sainz', 'Jonathan Rowe', 'Adam Idah', 'Kellen Fisher'],
  } },
  { name: 'Middlesbrough', shirt: '#DC0714', shorts: '#FFFFFF', strength: 0.95, press: 'high', squad: {
    GK: ['Seny Dieng', 'Tom Glover', 'Sol Brynn'],
    DEF: ['Dael Fry', 'Matt Clarke', 'Rav van den Berg', 'Neto Borges', 'Alex Bangura', 'Anfernee Dijksteel', 'Luke Hutchinson'],
    MID: ['Jonny Howson', 'Hayden Hackney', 'Finn Azaz', 'Sam Greenwood', 'Dan Barlaser'],
    FWD: ['Emmanuel Latte Lath', 'Delano Burgzorg', 'Ben Doak', 'Sonny Finch', 'Aidan Morris'],
  } },
  { name: 'Sheffield Wednesday', shirt: '#0066B3', shorts: '#0066B3', strength: 0.92, press: 'low', squad: {
    GK: ['James Beadle', 'Pierce Charles', 'Grady Kelly'],
    DEF: ["Di'Shon Bernard", 'Chey Dunkley', 'Yan Valery', 'Liam Palmer', 'Bambo Diaby', 'Jack Hunt', 'Max Lowe'],
    MID: ['Barry Bannan', 'Yosuke Ideguchi', 'Djeidi Gassama', 'Alex Hunt', 'Charlie McNeill'],
    FWD: ['Michael Smith', 'Anthony Musaba', 'Josh Windass', 'Bailey Cadamarteri'],
  } },
  { name: 'Watford', shirt: '#FBEE23', shorts: '#000000', strength: 0.94, press: 'mid', squad: {
    GK: ['Jonathan Bond', 'Daniel Bachmann', 'Vinny Adejumo'],
    DEF: ['Wesley Hoedt', 'Ryan Andrews', 'Jamal Lewis', 'Francisco Sierralta', 'Mattie Pollock', 'Ryan Porteous', 'Antonio Tikvić'],
    MID: ['Ken Sema', 'Yaser Asprilla', 'Edo Kayembe', 'Giorgi Chakvetadze', 'Tom Dele-Bashiru'],
    FWD: ['Rhys Healey', 'Vakoun Bayo', 'Mileta Rajović', 'Matheus Martins', 'Rocco Vata'],
  } },
  { name: 'Sheffield United', shirt: '#EE2737', shorts: '#000000', strength: 0.97, press: 'high', squad: {
    GK: ['Michael Cooper', 'Adam Davies', 'Louie Marsh'],
    DEF: ['Anel Ahmedhodžić', 'Jack Robinson', 'Rhys Norrington-Davies', 'Chris Basham', 'Femi Seriki', 'Jayden Bogle', 'Michael Craig'],
    MID: ['Sydie Peck', 'Gustavo Hamer', 'Vinícius Souza', 'Tom Davies', 'Andre Brooks'],
    FWD: ['Kieffer Moore', 'Ben Brereton Díaz', 'Rhian Brewster', 'Kai Corbett'],
  } },
  { name: 'Coventry City', shirt: '#78D0F2', shorts: '#78D0F2', strength: 0.93, press: 'mid', squad: {
    GK: ['Oliver Dovin', 'Ben Wilson', 'Jojo Wollacott'],
    DEF: ['Bobby Thomas', 'Jake Bidwell', 'Joel Latibeaudiere', 'Brooke Norton-Cuffy', 'Josh Wilson-Esbrand', 'Luis Binks'],
    MID: ['Josh Eccles', 'Ben Sheaf', 'Jack Rudoni', 'Josh Wright', 'Josh Pask'],
    FWD: ['Ellis Simms', 'Haji Wright', 'Tatsuhiro Sakamoto', 'Norman Bassette', 'Jayden Wareham'],
  } },
  { name: 'Bristol City', shirt: '#E21C21', shorts: '#FFFFFF', strength: 0.92, press: 'mid', squad: {
    GK: ["Max O'Leary", 'Stefan Marinović', 'Radek Vitek'],
    DEF: ['Rob Atkinson', 'Zak Vyner', 'Cam Pring', 'Ross McCrorie', 'Kal Naismith', 'George Tanner'],
    MID: ['Anis Mehmeti', 'Jason Knight', 'Harry Cornick', 'Yu Hirakawa', 'Ross McCormack'],
    FWD: ['Sinclair Armstrong', 'Nahki Wells', 'Ross Stewart', 'Tommy Conway'],
  } },
  { name: 'Preston North End', shirt: '#FFFFFF', shorts: '#1E2A5E', strength: 0.90, press: 'low', squad: {
    GK: ['Freddie Woodman', 'Gregor Zabret', 'Dai Cornell'],
    DEF: ['Liam Lindsay', 'Andrew Hughes', 'Josh Seary', 'Jack Whatmough', 'Robbie Brady'],
    MID: ['Ben Whiteman', 'Ryan Ledson', 'Duane Holmes', 'Ali McCann', 'Josh Onomah'],
    FWD: ['Milutin Osmajić', 'Emil Riis', 'Liam Millar', 'Will Keane', 'Mads Frøkjær'],
  } },
  { name: 'Swansea City', shirt: '#FFFFFF', shorts: '#FFFFFF', strength: 0.90, press: 'mid', squad: {
    GK: ['Lawrence Vigouroux', 'Carl Rushworth', 'Nathan Young-Coombes'],
    DEF: ['Ben Cabango', 'Nathan Wood', 'Josh Key', 'Ben Lloyd', 'Matty Sorinola', 'Harry Darling'],
    MID: ['Josh Ginnelly', 'Jamie Paterson', 'Goncalo Franco', 'Ollie Cooper', 'Josh Tymon'],
    FWD: ['Ronald', 'Liam Cullen', 'Zan Vipotnik', 'Josh Thomas'],
  } },
  { name: 'Hull City', shirt: '#F18A00', shorts: '#000000', strength: 0.89, press: 'low', squad: {
    GK: ['Ivor Pandur', 'Ryan Allsop', 'Harvey Davies'],
    DEF: ['Jacob Greaves', 'Alfie Jones', 'Charlie Hughes', 'Reece Burke', 'Regan Slater', 'Muskwe Karim'],
    MID: ['Jaden Philogene', 'Ozan Tufan', 'Joe Gelhardt', 'Ryan Longman', 'Cody Drameh'],
    FWD: ['Ryan Giles', 'Liam Delap', 'Abu Kamara', 'Gus Scott-Morriss'],
  } },
  { name: 'Millwall', shirt: '#001C58', shorts: '#FFFFFF', strength: 0.90, press: 'low', squad: {
    GK: ['Liam Roberts', 'Matija Šarkić', 'Lukas Jensen'],
    DEF: ['Japhet Tanganga', 'Ryan Leonard', 'Ryan Wells', 'Casper De Norre', 'Wes Harding'],
    MID: ['George Saville', 'Zian Flemming', 'Kevin Nisbet', 'Billy Mitchell', 'Jamie Shackleton'],
    FWD: ['Zak Emmerson', 'Aidomo Emakhu', 'Josh Coburn', 'Duncan Watmore'],
  } },
  { name: 'Blackburn Rovers', shirt: '#009EE0', shorts: '#FFFFFF', strength: 0.91, press: 'mid', squad: {
    GK: ['Aynsley Pears', 'Filip Marschall', 'Jacob Chapman'],
    DEF: ['Dominic Hyam', 'Callum Brittain', 'Sondre Tronstad', 'Tom Trybull', 'Domagoj Dujmović', 'Ryan Hedges'],
    MID: ['Yuki Ohashi', 'Joe Rankin-Costello', 'Sammie Szmodics', 'Vytas Duda'],
    FWD: ['Arnor Sigurdsson', 'Andreas Weimann', 'Todd Cantwell', 'Makenzie Kirk'],
  } },
  { name: 'Stoke City', shirt: '#E03A3E', shorts: '#FFFFFF', strength: 0.92, press: 'mid', squad: {
    GK: ['Viktor Johansson', 'Jack Bonham', 'Jetameion Gordon'],
    DEF: ['Ben Wilmot', 'Michael Rose', 'Enda Stevens', 'Junior Tchamadeu', 'Connor Taylor'],
    MID: ['Andrew Moran', 'Lewis Baker', 'Eric Bocat', 'Nathan Lowe', 'Wouter Burger'],
    FWD: ['Tom Cannon', 'Ryan Mmaee', 'Bae Jun-ho', 'Million Manhoef'],
  } },
  { name: 'Portsmouth', shirt: '#00285E', shorts: '#FFFFFF', strength: 0.93, press: 'mid', squad: {
    GK: ['Will Norris', 'Nicholas Bilokapić', 'Josh Oluwayemi'],
    DEF: ['Connor Ogilvie', 'Zak Swanson', 'Alfie Devine', 'Regan Poole', 'Conor Shaughnessy'],
    MID: ['Marlon Pack', 'Jay Mingi', 'Terry Devlin', 'Sean Raggett', 'Andre Dozzell'],
    FWD: ['Callum Lang', 'Colby Bishop', 'Josh Murphy', 'Kusini Yengi'],
  } },
  { name: 'Oxford United', shirt: '#FED100', shorts: '#001C58', strength: 0.87, press: 'low', squad: {
    GK: ['Jamie Cumming', 'Jack Stevens', 'Max Reading'],
    DEF: ['Elliott Moore', 'Bobby McCormack', 'Ciaron Brown', 'James Golding', 'Marcus McGuane'],
    MID: ['Cameron Brannagan', 'Dane Scarlett', 'Alex Gorrin', 'Tyler Goodrham', 'Idris El Mizouni'],
    FWD: ['Mark Harris', 'Ryan Williams', 'Sam Winnall', 'Kyle Joseph'],
  } },
  { name: 'Derby County', shirt: '#FFFFFF', shorts: '#000000', strength: 0.91, press: 'mid', squad: {
    GK: ['Josh Vickers', 'Jacob Widell Zetterström', 'Owen Goss'],
    DEF: ['Callum Elder', 'Curtis Nelson', 'Eiran Cashin', 'Max Bird', 'Sonny Bradley'],
    MID: ['Kane Wilson', 'Jerry Yates', 'Ebou Adams', 'Liam Thompson', 'Kwaku Oduroh'],
    FWD: ['Kayden Jackson', 'Martyn Waghorn', 'Tyrese Fornah', 'Nathaniel Mendez-Laing'],
  } },
  { name: 'Queens Park Rangers', shirt: '#1D5BA4', shorts: '#FFFFFF', strength: 0.88, press: 'low', squad: {
    GK: ['Asmir Begović', 'Murphy Mahoney', 'Joe Walsh'],
    DEF: ['Jimmy Dunne', 'Morgan Fox', 'Lucas Andersen', 'Sam Field', 'Jake Clarke-Salter'],
    MID: ['Ilias Chair', 'Jack Colback', 'Charlie Austin', 'Sean Goss', 'Jake Cooper'],
    FWD: ['Chris Willock', 'Michael Frey', 'Kwame Poku', 'Rayhaan Tulloch'],
  } },
  { name: 'Charlton Athletic', shirt: '#D2122E', shorts: '#FFFFFF', strength: 0.85, press: 'low', squad: {
    GK: ['Tom Hateley', 'Harry Isted', 'Ashley Maynard-Brewer'],
    DEF: ['Alfie Doughty', 'Naby Sarr', 'Lloyd Jones', 'Josh Edwards', 'Tom Lockyer'],
    MID: ['Alfie May', 'Greg Docherty', 'Tom Edwards', 'Miles Leaburn', 'Jesurun Rak-Sakyi'],
    FWD: ['Tyreece Campbell', 'Corey Blackett-Taylor', 'Karoy Anderson', 'Daniel Kanu'],
  } },
  { name: 'Wrexham', shirt: '#E01A2B', shorts: '#FFFFFF', strength: 0.86, press: 'mid', squad: {
    GK: ['Arthur Okonkwo', 'Mark Howard', 'Rob Lainton'],
    DEF: ['Ben Tozer', 'Eoghan O\'Connell', 'Aaron Hayden', 'Jordan Tunnicliffe', 'Max Cleworth'],
    MID: ['Elliot Lee', 'James McClean', 'Andy Cannon', 'George Dobson', 'Sam Vokes'],
    FWD: ['Paul Mullin', 'Ollie Palmer', 'Sam Dalby', 'Steven Fletcher'],
  } },
  { name: 'Birmingham City', shirt: '#0000FF', shorts: '#FFFFFF', strength: 0.94, press: 'high', squad: {
    GK: ['Tommy Simkin', 'John Ruddy', 'Ted Cann'],
    DEF: ['Kristian Pedersen', 'Ethan Ross', 'Krystian Bielik', 'Ionut Nes', 'Marc Leonard'],
    MID: ['Alfie Chang', 'Jordan James', 'Josh Williams', 'Alex Cochrane', 'Cieran Dunne'],
    FWD: ['Jay Stansfield', 'Tommy Doyle', 'Emil Hansson', 'Demi Mitchell'],
  } },
];

const SERIE_A_TEAMS = [
  { name: 'Napoli', shirt: '#12A0D7', shorts: '#12A0D7', strength: 1.12, press: 'high', squad: {
    GK: ['Alex Meret', 'Elia Caprile', 'Vincenzo Fiorillo'],
    DEF: ['Amir Rrahmani', 'Juan Jesus', 'Giovanni Di Lorenzo', 'Mathías Olivera', 'Alessandro Buongiorno', 'Leonardo Spinazzola', 'Leonardo Marfella'],
    MID: ['Stanislav Lobotka', 'Frank Anguissa', 'Scott McTominay', 'Billy Gilmour', 'Diego Demme'],
    FWD: ['Romelu Lukaku', 'David Neres', 'Giacomo Raspadori', 'Matteo Politano', 'Noa Lang'],
  } },
  { name: 'AS Roma', shirt: '#8E1F2F', shorts: '#F0BC42', strength: 1.05, press: 'mid', squad: {
    GK: ['Mile Svilar', 'Pierluigi Gollini', 'Alessio Ciocci'],
    DEF: ['Gianluca Mancini', 'Evan Ndicka', 'Mario Hermoso', 'Wesley', 'Devyne Rensch', 'Zeki Çelik', 'Nicola Zalewski'],
    MID: ['Bryan Cristante', 'Manu Koné', 'Lorenzo Pellegrini', 'Leandro Paredes', 'Niccolò Pisilli'],
    FWD: ['Artem Dovbyk', 'Paulo Dybala', 'Matías Soulé', 'Eldor Shomurodov', 'Tommaso Baldanzi'],
  } },
  { name: 'Juventus', shirt: '#FFFFFF', shorts: '#000000', strength: 1.10, press: 'mid', squad: {
    GK: ['Michele Di Gregorio', 'Mattia Perin', 'Carlo Pinsoglio'],
    DEF: ['Gleison Bremer', 'Federico Gatti', 'Pierre Kalulu', 'Andrea Cambiaso', 'Juan Cabal', 'Lloyd Kelly', 'Nicolò Savona'],
    MID: ['Manuel Locatelli', 'Khéphren Thuram', 'Teun Koopmeiners', 'Weston McKennie', 'Fabio Miretti'],
    FWD: ['Dušan Vlahović', 'Kenan Yıldız', 'Francisco Conceição', 'Randal Kolo Muani', 'Vasilije Adžić'],
  } },
  { name: 'AC Milan', shirt: '#FB090B', shorts: '#000000', strength: 1.08, press: 'high', squad: {
    GK: ['Mike Maignan', 'Marco Sportiello', 'Lorenzo Torriani'],
    DEF: ['Fikayo Tomori', 'Malick Thiaw', 'Theo Hernández', 'Davide Calabria', 'Strahinja Pavlović', 'Emerson Royal', 'Kyle Walker'],
    MID: ['Youssouf Fofana', 'Ismaël Bennacer', 'Luka Modrić', 'Yunus Musah', 'Warren Bondo'],
    FWD: ['Christian Pulisic', 'Santiago Giménez', 'Rafael Leão', 'Tammy Abraham', 'Samuel Chukwueze'],
  } },
  { name: 'Inter Milan', shirt: '#0C4396', shorts: '#000000', strength: 1.14, press: 'high', squad: {
    GK: ['Yann Sommer', 'Josep Martínez', 'Raffaele Di Gennaro'],
    DEF: ['Alessandro Bastoni', 'Francesco Acerbi', 'Benjamin Pavard', 'Denzel Dumfries', 'Federico Dimarco', 'Yann Bisseck', 'Matteo Darmian'],
    MID: ['Hakan Çalhanoğlu', 'Nicolò Barella', 'Henrikh Mkhitaryan', 'Piotr Zieliński', 'Kristjan Asllani'],
    FWD: ['Lautaro Martínez', 'Marcus Thuram', 'Mehdi Taremi', 'Ange-Yoan Bonny', 'Petar Sučić'],
  } },
  { name: 'Atalanta', shirt: '#1E71B8', shorts: '#000000', strength: 1.04, press: 'high', squad: {
    GK: ['Marco Carnesecchi', 'Francesco Rossi', 'Alex Sabbatini'],
    DEF: ['Isak Hien', 'Berat Djimsiti', 'Sead Kolašinac', 'Raoul Bellanova', 'Odilon Kossounou', 'Mitchel Bakker', 'Giorgio Scalvini'],
    MID: ['Marten de Roon', 'Ederson', 'Lazar Samardžić', 'Brescianini', 'Marco Palestra'],
    FWD: ['Charles De Ketelaere', 'Mateo Retegui', 'Ademola Lookman', 'El Bilal Touré', 'Giovanni Bellomo'],
  } },
  { name: 'Fiorentina', shirt: '#5A2D81', shorts: '#5A2D81', strength: 1.00, press: 'mid', squad: {
    GK: ['David de Gea', 'Tommaso Martinelli', 'Oliver Christensen'],
    DEF: ['Pietro Comuzzo', 'Luca Ranieri', 'Dodô', 'Fabiano Parisi', 'Marin Pongračić', 'Robin Gosens', 'Cher Ndour'],
    MID: ['Rolando Mandragora', 'Yacine Adli', 'Danilo Cataldi', 'Amir Richardson', 'Jonathan Ikoné'],
    FWD: ['Moise Kean', 'Albert Guðmundsson', 'Edin Džeko', 'Riccardo Sottil', 'Lucas Beltrán'],
  } },
  { name: 'Lazio', shirt: '#A9D6F5', shorts: '#FFFFFF', strength: 1.01, press: 'mid', squad: {
    GK: ['Ivan Provedel', 'Christos Mandas', 'Alessio Furlanetto'],
    DEF: ['Alessio Romagnoli', 'Mario Gila', 'Adam Marušić', 'Nuno Tavares', 'Patric', 'Oliver Provstgaard', 'Elseid Hysaj'],
    MID: ['Nicolò Rovella', 'Matteo Guendouzi', 'Reda Belahyane', 'Toma Bašić', 'Fisayo Dele-Bashiru'],
    FWD: ['Valentín Castellanos', 'Gustav Isaksen', 'Boulaye Dia', 'Pedro', 'Tijjani Noslin'],
  } },
  { name: 'Bologna', shirt: '#A81319', shorts: '#132257', strength: 1.02, press: 'mid', squad: {
    GK: ['Lukasz Skorupski', 'Federico Ravaglia', 'Nicola Pirini'],
    DEF: ['Sam Beukema', 'Jhon Lucumí', 'Stefan Posch', 'Emil Holm', 'Charalampos Lykogiannis', 'Martin Erlic'],
    MID: ['Remo Freuler', 'Lewis Ferguson', 'Nikola Moro', 'Giovanni Fabbian', 'Tommaso Corazza'],
    FWD: ['Riccardo Orsolini', 'Santiago Castro', 'Thijs Dallinga', 'Ciro Immobile'],
  } },
  { name: 'Torino', shirt: '#881D23', shorts: '#881D23', strength: 0.96, press: 'mid', squad: {
    GK: ['Franco Israel', 'Nikita Contini', 'Alessandro Vismara'],
    DEF: ['Saul Coco', 'Guillermo Maripán', 'Marcus Pedersen', 'Adam Masina', 'Valentino Lazaro'],
    MID: ['Samuele Ricci', 'Ivan Ilić', 'Nikola Vlašić', 'Gvidas Gineitis', 'Karol Linetty'],
    FWD: ['Duván Zapata', 'Che Adams', 'Cesare Casadei', 'Antonio Sanabria'],
  } },
  { name: 'Udinese', shirt: '#000000', shorts: '#FFFFFF', strength: 0.94, press: 'low', squad: {
    GK: ['Razvan Sava', 'Maduka Okoye', 'Daniele Padelli'],
    DEF: ['Jaka Bijol', 'Christian Kabasele', 'Nehuén Pérez', 'Kingsley Ehizibue', 'Jamie Lucas'],
    MID: ['Sandi Lovric', 'Jean-Victor Makengo', 'Oier Zarraga', 'Arthur Atta'],
    FWD: ['Lorenzo Lucca', 'Florian Thauvin', 'Keinan Davis', 'Iker Bravo'],
  } },
  { name: 'Genoa', shirt: '#C6003C', shorts: '#001E62', strength: 0.93, press: 'low', squad: {
    GK: ['Nicola Leali', 'Sebastiano Desplanches', 'Pietro Sommariva'],
    DEF: ['Aaron Martín', 'Johan Vásquez', 'Koni De Winter', 'Alan Matturro', 'Milan Đurić'],
    MID: ['Morten Frendrup', 'Stefano Sabelli', 'Ruslan Malinovskyi', 'Aidan Ekana'],
    FWD: ['Fabio Depaoli', 'Caleb Ekuban', 'Junior Messias', 'Andrea Cotali'],
  } },
  { name: 'Cagliari', shirt: '#B90E0A', shorts: '#00287A', strength: 0.90, press: 'low', squad: {
    GK: ['Boris Radunović', 'Simone Murru', 'Alessio Zamarion'],
    DEF: ['Yerry Mina', 'Alberto Dossena', 'Adam Obert', 'Gabriele Zappa', 'Sebastiano Luperto'],
    MID: ['Nadir Zortea', 'Michael Folorunsho', 'Antoine Makoumbou', 'Jakub Jankto'],
    FWD: ['Roberto Piccoli', 'Gianluca Lapadula', 'Zito Luvumbo', 'Leonardo Pavoletti'],
  } },
  { name: 'Hellas Verona', shirt: '#FDD017', shorts: '#00205B', strength: 0.88, press: 'low', squad: {
    GK: ['Lorenzo Montipò', 'Simone Perilli', 'Nicolas Sava'],
    DEF: ['Diego Coppola', 'Martin Frese', 'Casper Tengstedt', 'Giovanni Bella', 'Jackson Tchatchoua'],
    MID: ['Suat Serdar', 'Grigoris Kastanos', 'Ondrej Duda', 'Muhamed Belaid'],
    FWD: ['Amin Sarr', 'Gift Orban', 'Daniel Mosquera', 'Chleayande Sarr'],
  } },
  { name: 'Como', shirt: '#003399', shorts: '#FFFFFF', strength: 0.92, press: 'mid', squad: {
    GK: ['Pepe Reina', 'Jean Butez', 'Emil Audero'],
    DEF: ['Alberto Moreno', 'Marc-Oliver Kempf', 'Ivan Smolčić', 'Alex Valle', 'Mërgim Vojvoda'],
    MID: ['Lucas Da Cunha', 'Nico Paz', 'Máximo Perrone', 'Martin Baturina'],
    FWD: ['Patrick Cutrone', 'Assane Diao', 'Alieu Fadera', 'Gabriel Strefezza'],
  } },
  { name: 'Parma', shirt: '#FFD700', shorts: '#002169', strength: 0.90, press: 'low', squad: {
    GK: ['Zion Suzuki', 'Edoardo Corvi', 'Filippo Corradi'],
    DEF: ['Botond Balogh', 'Emanuele Valeri', 'Enrico Delprato', 'Woyo Coulibaly', 'Christian Ordoñez'],
    MID: ['Adrián Bernabé', 'Simon Sohm', 'Hernani', 'Matteo Cremaschi'],
    FWD: ['Dennis Man', 'Mateo Pellegrino', 'Emanuel Vignato', 'Valentín Mihăilă'],
  } },
  { name: 'Lecce', shirt: '#FFD700', shorts: '#C8102E', strength: 0.87, press: 'low', squad: {
    GK: ['Wladimiro Falcone', 'Marco Bleve', 'Marco Fruncillo'],
    DEF: ['Federico Baschirotto', 'Kialonda Gaspar', 'Lorenzo Venuti', 'Antonino Gallo', 'Marco Pierotti'],
    MID: ['Ylber Ramadani', 'Lassana Coulibaly', 'Balthazar Pierret', 'Lameck Banda'],
    FWD: ['Nikola Krstović', 'Antonio Morata', 'Ante Rebić', 'Nikola Stulić'],
  } },
  { name: 'Sassuolo', shirt: '#00A650', shorts: '#000000', strength: 0.91, press: 'mid', squad: {
    GK: ['Stefano Turati', 'Alessandro Russo', 'Elia Consigli'],
    DEF: ['Matteo Doig', 'Filippo Romagna', 'Josh Doig', 'Dario Saric', 'Marco Pieragnolo'],
    MID: ['Kristian Thorstvedt', 'Cristian Volpato', 'Nicolò Armellino', 'Filippo Missori'],
    FWD: ['Andrea Pinamonti', 'Domenico Berardi', 'Armand Laurienté', 'Cheddira Walid'],
  } },
  { name: 'Pisa', shirt: '#001E62', shorts: '#001E62', strength: 0.86, press: 'low', squad: {
    GK: ['Adrian Semper', 'Simone Scuffet', 'Michele Vannucchi'],
    DEF: ['Idrissa Touré', 'Arturo Calabresi', 'Marius Marin', 'Simone Canestrelli', 'Filippo Bonini'],
    MID: ['Marius Adamonis', 'Alessandro Bonfanti', 'Denis Vasic', 'Nicholas Bonfanti'],
    FWD: ["M'Bala Nzola", 'Matteo Tramoni', 'Henrik Meister', 'Antonio Piccinini'],
  } },
];

const LA_LIGA_TEAMS = [
  { name: 'Real Madrid', shirt: '#FFFFFF', shorts: '#FFFFFF', strength: 1.16, press: 'high', squad: {
    GK: ['Thibaut Courtois', 'Andriy Lunin', 'Fran González'],
    DEF: ['Dani Carvajal', 'Antonio Rüdiger', 'Éder Militão', 'David Alaba', 'Fran García', 'Raúl Asencio'],
    MID: ['Jude Bellingham', 'Eduardo Camavinga', 'Aurélien Tchouaméni', 'Federico Valverde', 'Dani Ceballos'],
    FWD: ['Kylian Mbappé', 'Vinícius Júnior', 'Rodrygo', 'Endrick', 'Arda Güler'],
  } },
  { name: 'Barcelona', shirt: '#A50044', shorts: '#004D98', strength: 1.15, press: 'high', squad: {
    GK: ['Marc-André ter Stegen', 'Iñaki Peña', 'Wojciech Szczęsny'],
    DEF: ['Jules Koundé', 'Pau Cubarsí', 'Ronald Araújo', 'Alejandro Balde', 'Andreas Christensen', 'Éric García'],
    MID: ['Pedri', 'Gavi', 'Frenkie de Jong', 'Marc Casadó', 'Dani Olmo'],
    FWD: ['Robert Lewandowski', 'Raphinha', 'Lamine Yamal', 'Ferran Torres', 'Roony Bardghji'],
  } },
  { name: 'Atlético Madrid', shirt: '#CB3524', shorts: '#0A1E63', strength: 1.08, press: 'high', squad: {
    GK: ['Jan Oblak', 'Juan Musso', 'Ivo Grbić'],
    DEF: ['José Giménez', 'Clément Lenglet', 'Robin Le Normand', 'Reinildo', 'Nahuel Molina', 'César Azpilicueta'],
    MID: ['Koke', 'Rodrigo De Paul', 'Pablo Barrios', 'Marcos Llorente', 'Conor Gallagher'],
    FWD: ['Julián Álvarez', 'Antoine Griezmann', 'Alexander Sørloth', 'Giuliano Simeone'],
  } },
  { name: 'Athletic Bilbao', shirt: '#EE2523', shorts: '#FFFFFF', strength: 1.00, press: 'high', squad: {
    GK: ['Unai Simón', 'Julen Agirrezabala', 'Jon Ander Garrido'],
    DEF: ['Yeray Álvarez', 'Dani Vivian', 'Aitor Paredes', 'Yuri Berchiche', 'Andoni Gorosabel'],
    MID: ['Mikel Vesga', 'Óscar de Marcos', 'Unai Gómez', 'Iñigo Ruiz de Galarreta', 'Beñat Prados'],
    FWD: ['Nico Williams', 'Iñaki Williams', 'Gorka Guruzeta', 'Oihan Sancet', 'Álex Berenguer'],
  } },
  { name: 'Real Sociedad', shirt: '#0067B1', shorts: '#FFFFFF', strength: 0.98, press: 'mid', squad: {
    GK: ['Álex Remiro', 'Unai Marrero', 'Mathieu Cafaro'],
    DEF: ['Aritz Elustondo', 'Igor Zubeldia', 'Jon Aramburu', 'Diego Rico', 'Jon Pacheco'],
    MID: ['Beñat Turrientes', 'Sergio Gómez', 'Brais Méndez', 'Arsen Zakharyan'],
    FWD: ['Mikel Oyarzabal', 'Take Kubo', 'Ander Barrenetxea', 'Umar Sadiq', 'Orri Óskarsson'],
  } },
  { name: 'Real Betis', shirt: '#00A650', shorts: '#FFFFFF', strength: 0.97, press: 'mid', squad: {
    GK: ['Rui Silva', 'Fran Vieites', 'Adrián San Miguel'],
    DEF: ['Héctor Bellerín', 'Marc Bartra', 'Diego Llorente', 'Álex Moreno', 'Natan'],
    MID: ['Marc Roca', 'Johnny Cardoso', 'Nabil Fekir', 'Sergi Altimira'],
    FWD: ['Isco', 'Cédric Bakambu', 'Ayoze Pérez', 'Vitor Roque', 'Antony'],
  } },
  { name: 'Sevilla', shirt: '#FFFFFF', shorts: '#0B1F4B', strength: 0.95, press: 'mid', squad: {
    GK: ['Ørjan Nyland', 'Álvaro Fernández', 'Alfonso Pastor'],
    DEF: ['Loïc Badé', 'Kike Salas', 'Marcao', 'Adrià Pedrosa', 'Valentín Gómez'],
    MID: ['Nemanja Gudelj', 'Saúl Ñíguez', 'Djibril Sow', 'Lucien Agoumé', 'Joan Jordán'],
    FWD: ['Isaac Romero', 'Dodi Lukébakio', 'Akor Adams', 'Alfon González'],
  } },
  { name: 'Villarreal', shirt: '#FFE667', shorts: '#003DA5', strength: 0.99, press: 'mid', squad: {
    GK: ['Diego Conde', 'Luiz Júnior', 'José Pardo'],
    DEF: ['Rafa Marín', 'Logan Costa', 'Santiago Mouriño', 'Sergi Cardona', 'Alfonso Pedraza'],
    MID: ['Dani Parejo', 'Álex Baena', 'Pape Gueye', 'Denis Suárez', 'Adrián Embarba'],
    FWD: ['Nicolas Pépé', 'Gerard Moreno', 'Thierno Barry', 'Tajon Buchanan'],
  } },
  { name: 'Valencia', shirt: '#FFFFFF', shorts: '#000000', strength: 0.93, press: 'mid', squad: {
    GK: ['Stole Dimitrievski', 'Jaume Doménech', 'Christian Rivero'],
    DEF: ['Mouctar Diakhaby', 'César Tárrega', 'José Gayà', 'Thierry Correia', 'Cristhian Mosquera'],
    MID: ['Javi Guerra', 'Pepelu', 'Fran Pérez', 'Dani Raba', 'Pepelu Rodríguez'],
    FWD: ['Hugo Duro', 'Rafa Mir', 'Diego López', 'Luis Rioja'],
  } },
  { name: 'Celta Vigo', shirt: '#8AC7E0', shorts: '#FFFFFF', strength: 0.92, press: 'mid', squad: {
    GK: ['Vicente Guaita', 'Iván Villar', 'Ionut Radu'],
    DEF: ['Carl Starfelt', 'Óscar Mingueza', 'Javi Rodríguez', 'Marcos Alonso', 'Yoel Lago'],
    MID: ['Fer López', 'Hugo Sotelo', 'Damián Rodríguez', 'Fran Beltrán'],
    FWD: ['Borja Iglesias', 'Williot Swedberg', 'Jonathan Bamba', 'Pablo Durán'],
  } },
  { name: 'Osasuna', shirt: '#D2001C', shorts: '#0B1F4B', strength: 0.91, press: 'mid', squad: {
    GK: ['Sergio Herrera', 'Aitor Fernández', 'Iñaki Sáez'],
    DEF: ['David García', 'Alejandro Catena', 'Jesús Areso', 'Juan Cruz', 'Rubén Peña'],
    MID: ['Moi Gómez', 'Lucas Torró', 'Aimar Oroz', 'Jon Moncayola'],
    FWD: ['Ante Budimir', 'Bryan Zaragoza', 'Rubén García', 'Abde Rebbach'],
  } },
  { name: 'Girona', shirt: '#CB1517', shorts: '#FFFFFF', strength: 0.93, press: 'mid', squad: {
    GK: ['Paulo Gazzaniga', 'Juan Carlos', 'Pablo Vicario'],
    DEF: ['David López', 'Ricard Artero', 'Miguel Gutiérrez', 'Arnau Martínez', 'Ricard García'],
    MID: ['Aleix García', 'Iván Martín', 'Yangel Herrera', 'Pablo Torre'],
    FWD: ['Cristhian Stuani', 'Bryan Gil', 'Portu', 'Abel Ruiz'],
  } },
  { name: 'Rayo Vallecano', shirt: '#E2001A', shorts: '#0B1F4B', strength: 0.92, press: 'high', squad: {
    GK: ['Augusto Batalla', 'Alberto García', 'Dimitrievski Stole'],
    DEF: ['Abdul Mumin', 'Florian Lejeune', 'Iván Balliu', 'Pep Chavarría', 'Bebé'],
    MID: ['Óscar Trejo', 'Unai López', 'Pathé Ciss', 'Randy Nteka'],
    FWD: ['Isi Palazón', 'Raúl de Tomás', 'Álvaro García', 'Jorge de Frutos'],
  } },
  { name: 'Getafe', shirt: '#005BAA', shorts: '#0B1F4B', strength: 0.90, press: 'low', squad: {
    GK: ['David Soria', 'Luca Zidane', 'Andrés Fernández'],
    DEF: ['Domingos Duarte', 'Djené Dakonam', 'Juan Iglesias', 'Mika Mármol', 'Alejandro Iturbe'],
    MID: ['Luis Milla', 'Mauro Arambarri', 'Jaime Mata', 'Nemanja Maksimović'],
    FWD: ['Borja Mayoral', 'Adu Ares', 'Coba', 'Mario Martín'],
  } },
  { name: 'Mallorca', shirt: '#CB1517', shorts: '#000000', strength: 0.89, press: 'low', squad: {
    GK: ['Leo Román', 'Dominik Greif', 'Miquel Parera'],
    DEF: ['Antonio Raíllo', 'Martin Valjent', 'Pablo Maffeo', 'Johan Mojica', 'Jan Salas'],
    MID: ['Sergi Darder', 'Manu Morlanes', 'Antonio Sánchez', 'Samú Costa'],
    FWD: ['Vedat Muriqi', 'Cyle Larin', 'Takuma Asano', 'Dani Rodríguez'],
  } },
  { name: 'Alavés', shirt: '#0057A8', shorts: '#0057A8', strength: 0.88, press: 'low', squad: {
    GK: ['Antonio Sivera', 'Jonathan Dubasin', 'Pacífico Ojeda'],
    DEF: ['Rodrigo Sánchez', 'Abdel Abqar', 'Nahuel Tenaglia', 'Manu Sánchez', 'Adrián García'],
    MID: ['Antonio Blanco', 'Jon Guridi', 'Ianis Hagi', 'Antonio Martínez'],
    FWD: ['Kike García', 'Toni Martínez', 'Carlos Vicente', 'Aleix Vidal'],
  } },
  { name: 'Espanyol', shirt: '#003DA5', shorts: '#FFFFFF', strength: 0.87, press: 'mid', squad: {
    GK: ['Fernando Pacheco', 'Joan García', 'Iervolino Gaston'],
    DEF: ['Omar El Hilali', 'Leandro Cabrera', 'Sergi Gómez', 'Brian Oliván', 'Nabil Touaizi'],
    MID: ['Pol Lozano', 'Edu Expósito', 'Álex Kral', 'Marc Pubill'],
    FWD: ['Javi Puado', 'Roberto Fernández', 'Dani Gómez', 'Irvin Cardona'],
  } },
  { name: 'Las Palmas', shirt: '#FFDD00', shorts: '#0B1F4B', strength: 0.86, press: 'low', squad: {
    GK: ['Álvaro Valles', 'Dinko Horkas', 'Álex Domínguez'],
    DEF: ['Álex Suárez', 'Javi Muñoz', 'Sergio Suárez', 'Saúl Corral', 'Raúl Fernández'],
    MID: ['Kirian Rodríguez', 'Enzo Loiodice', 'Fabio González', 'Vitor Nuno'],
    FWD: ['Sandro Ramírez', 'Marc Cardona', 'Alberto Moleiro', 'Manu Fuster'],
  } },
  { name: 'Leganés', shirt: '#002E62', shorts: '#002E62', strength: 0.85, press: 'low', squad: {
    GK: ['Marko Dmitrović', 'Juan Soriano', 'Andrés Prieto'],
    DEF: ['Valentín Rosier', 'Sergio González', 'Matija Nastasić', 'Jorge Sáenz', 'Renato Tapia'],
    MID: ['Seydouba Cissé', 'Yellu Santiago', 'Diego García', 'Óscar Rodríguez'],
    FWD: ['Miguel de la Fuente', 'Munir El Haddadi', 'Yeboah Amankwah', 'Sergio Barcia'],
  } },
  { name: 'Real Valladolid', shirt: '#6B2C91', shorts: '#FFFFFF', strength: 0.85, press: 'low', squad: {
    GK: ['Karl Hein', 'Guillermo Vallejo', 'Óscar Whalley'],
    DEF: ['David Torres', 'Mario Marín', 'Anuar Tuhami', 'Kike Pérez', 'Rubén Alcaraz'],
    MID: ['Iván Alejo', 'Amath Ndiaye', 'Stanko Juric', 'Yusi'],
    FWD: ['Marcos André', 'Selim Amallah', 'Juanmi Latasa', 'Ivan Chapela'],
  } },
];

const LIGUE1_TEAMS = [
  { name: 'Paris Saint-Germain', shirt: '#041E42', shorts: '#041E42', strength: 1.14, press: 'high', squad: {
    GK: ['Gianluigi Donnarumma', 'Matvey Safonov', 'Arnau Tenas'],
    DEF: ['Achraf Hakimi', 'Marquinhos', 'Nuno Mendes', 'Willian Pacho', 'Lucas Beraldo', 'Lucas Hernandez'],
    MID: ['Vitinha', 'Fabián Ruiz', 'João Neves', 'Warren Zaïre-Emery', 'Senny Mayulu'],
    FWD: ['Ousmane Dembélé', 'Bradley Barcola', 'Khvicha Kvaratskhelia', 'Gonçalo Ramos', 'Ibrahim Mbaye'],
  } },
  { name: 'Marseille', shirt: '#FFFFFF', shorts: '#FFFFFF', strength: 1.02, press: 'high', squad: {
    GK: ['Gerónimo Rulli', 'Rubén Blanco', 'Jeffrey de Lange'],
    DEF: ['Leonardo Balerdi', 'Derek Cornelius', 'Ulisses Garcia', 'Amir Murillo', 'Nayef Aguerd'],
    MID: ['Geoffrey Kondogbia', 'Angel Gomes', 'Bilal Nadir', 'Pierre-Emerick Highsmith'],
    FWD: ['Mason Greenwood', 'Amine Gouiri', 'Neal Maupay', 'Luis Henrique', 'Robinio Vaz'],
  } },
  { name: 'Monaco', shirt: '#E51937', shorts: '#FFFFFF', strength: 1.01, press: 'mid', squad: {
    GK: ['Radosław Majecki', 'Philipp Köhn', 'Lucas Sasso'],
    DEF: ['Wilfried Singo', 'Thilo Kehrer', 'Christian Mawissa', 'Caio Henrique', 'Jordan Teze'],
    MID: ['Denis Zakaria', 'Lamine Camara', 'Aleksandr Golovin', 'Eliesse Ben Seghir'],
    FWD: ['Folarin Balogun', 'Takumi Minamino', 'George Ilenikhena', 'Mika Biereth'],
  } },
  { name: 'Lyon', shirt: '#FFFFFF', shorts: '#1D4599', strength: 0.98, press: 'mid', squad: {
    GK: ['Rémy Descamps', 'Lucas Perri', 'Nicolas Ochoa'],
    DEF: ['Moussa Niakhaté', 'Nicolás Tagliafico', 'Saël Kumbedi', 'Duje Ćaleta-Car', 'Clinton Mata'],
    MID: ['Corentin Tolisso', 'Tanner Tessmann', 'Nemanja Matić', 'Pavel Šulc'],
    FWD: ['Alexandre Lacazette', 'Malick Fofana', 'Afonso Moreira', 'Ernest Nuamah'],
  } },
  { name: 'Lille', shirt: '#DA291C', shorts: '#FFFFFF', strength: 0.96, press: 'mid', squad: {
    GK: ['Berke Özer', 'Vito Mannone', 'Dorian Bertrand'],
    DEF: ['Alexsandro', 'Aïssa Mandi', 'Ismaily', 'Bafodé Diakité', 'Aïssa Laïdouni'],
    MID: ['Rémy Cabella', 'Benjamin André', 'Nabil Bentaleb', 'Ayyoub Bouaddi'],
    FWD: ['Mohamed Bayo', 'Edon Zhegrova', 'Jonathan David', 'Hákon Haraldsson'],
  } },
  { name: 'Nice', shirt: '#CC092F', shorts: '#000000', strength: 0.94, press: 'mid', squad: {
    GK: ['Marcin Bułka', 'Yehvann Diouf', 'Teddy Boulhendi'],
    DEF: ['Jean-Clair Todibo', 'Dante', 'Melvin Bard', 'Antoine Mendy', 'Jonathan Clauss'],
    MID: ['Sofiane Diop', 'Morgan Sanson', 'Hicham Boudaoui', 'Tanguy Ndombele'],
    FWD: ['Terem Moffi', 'Evann Guessand', 'Gaëtan Laborde', 'Badredine Bouanani'],
  } },
  { name: 'Lens', shirt: '#DA291C', shorts: '#FFD700', strength: 0.94, press: 'high', squad: {
    GK: ['Brice Samba', 'Yannis Clementia', 'Bingourou Kamara'],
    DEF: ['Facundo Medina', 'Kevin Danso', 'Jonathan Gradit', 'Deiver Machado', 'Malang Sarr'],
    MID: ['Andy Diouf', 'Angelo Fulgini', 'Adrien Thomasson', 'Przemysław Frankowski'],
    FWD: ['Wesley Saïd', 'Florian Sotoca', 'Elye Wahi', 'Neil El Aynaoui'],
  } },
  { name: 'Rennes', shirt: '#E2231A', shorts: '#000000', strength: 0.93, press: 'mid', squad: {
    GK: ['Steve Mandanda', 'Gauthier Gallon', 'Sacha-Kelvin Gbem'],
    DEF: ['Lorenz Assignon', 'Christopher Wooh', 'Adrien Truffert', 'Warmed Omari', 'Jeanuël Belocian'],
    MID: ['Djaoui Cissé', 'Baptiste Santamaria', 'Seko Fofana', 'Alidu Seidu'],
    FWD: ['Ludovic Blas', 'Arnaud Kalimuendo', 'Jonas Martin', 'Fabian Rieder'],
  } },
  { name: 'Strasbourg', shirt: '#1C3F94', shorts: '#1C3F94', strength: 0.91, press: 'high', squad: {
    GK: ['Alaa Bellaarouch', 'Sacha Delaye', 'Christoph Blaswich'],
    DEF: ['Guela Doué', 'Abakar Sylla', 'Saïdou Sow', 'Thomas Delaine', 'Marvin Senaya'],
    MID: ['Habib Diarra', 'Andrey Santos', 'Dilane Bakwa', 'Caleb Wiley'],
    FWD: ['Emanuel Emegha', 'Félix Lemaréchal', 'Sebastián Nanasi', 'Joaquín Panichelli'],
  } },
  { name: 'Toulouse', shirt: '#6B3FA0', shorts: '#6B3FA0', strength: 0.89, press: 'mid', squad: {
    GK: ['Christian Ortiz', 'Baptiste Reynet', 'Guillaume Restes'],
    DEF: ['Rasmus Nicolaisen', 'Anthony Rouault', 'Moussa Diarra', 'Vitor Costa', 'Rafael Ratão'],
    MID: ['Aron Dønnum', 'Farès Chaïbi', 'Cristian Cásseres', 'Stijn Spierings'],
    FWD: ['Yann Gboho', 'Frank Magri', 'Zakaria Aboukhlal', 'Kader Bamba'],
  } },
  { name: 'Nantes', shirt: '#FDE100', shorts: '#00843D', strength: 0.88, press: 'mid', squad: {
    GK: ['Alban Lafont', 'Anthony Lopes', 'Baptiste Geffray'],
    DEF: ['Nicolas Pallois', 'Andrei Girotto', 'Fabien Centonze', 'Charles Traoré', 'Jean-Charles Castelletto'],
    MID: ['Pedro Chirivella', 'Sean Zanon', 'Bahereba Guirassy', 'Fabio Ceppitelli'],
    FWD: ['Mostafa Mohamed', 'Moses Simon', 'Matthis Abline', 'Marcus Coco'],
  } },
  { name: 'Brest', shirt: '#DA291C', shorts: '#FFFFFF', strength: 0.90, press: 'mid', squad: {
    GK: ['Anthony Mandrea', 'Grégoire Coudert', 'Gauthier Gorgelin'],
    DEF: ['Bradley Locko', 'Lilian Brassier', 'Jules Reynaud', 'Kenny Lala', 'Bilal Nadir Sissoko'],
    MID: ['Pierre Lees-Melou', 'Mahdi Camara', 'Romain Del Castillo', 'Hugo Magnetti'],
    FWD: ['Ludovic Ajorque', 'Abdallah Sima', 'Steve Mounié', 'Jean-Kevin Duverne'],
  } },
  { name: 'Le Havre', shirt: '#4AA8DE', shorts: '#0B1F4B', strength: 0.86, press: 'low', squad: {
    GK: ['Arthur Desmas', 'Mathieu Gorgelin', 'Elysee Logbo'],
    DEF: ['Mickaël Alphonse', 'Ognjen Gnjatić', 'Kamory Doumbia', 'Arouna Sanganté', 'Loick Landre'],
    MID: ['Josué Casimir', 'Gautier Lloris', 'Yassine Kechta', 'Mathias Coureur'],
    FWD: ['Rassoul Ndiaye', 'Oualid El Hajjam', 'Aldo Kalulu', 'Yannis Ngando'],
  } },
  { name: 'Auxerre', shirt: '#FFFFFF', shorts: '#1C3F94', strength: 0.87, press: 'mid', squad: {
    GK: ['Donovan Léon', 'Hervé Koffi', 'Ted Loba'],
    DEF: ['Jubal', 'Ibou Sané', 'Perrin', 'Anthony Gonçalves', 'Rayann Philippe'],
    MID: ['Sinaly Diomandé', 'Elisha Owusu', 'Kayky', 'Gauthier Hein'],
    FWD: ['Lassine Sinayoko', 'Ibrahima Niane', 'Zach Sturm', 'Yasser Larouci'],
  } },
  { name: 'Angers', shirt: '#000000', shorts: '#FFFFFF', strength: 0.85, press: 'low', squad: {
    GK: ['Yahia Fofana', 'Paul Bernardoni', 'Vincent Demarconnay'],
    DEF: ['Rayan Fofana', 'Thomas Mangani', 'Bilal Boutobba', 'Souleyman Doumbia', 'Enzo Ilmer'],
    MID: ['Himad Abdelli', 'Kylian Mbemba', 'Farid El Melali', 'Naameh Bouasse'],
    FWD: ['Jim Allevinah', 'Adrian Bongiovanni', 'Esteban Lepaul', 'Yohan Boli'],
  } },
  { name: 'Metz', shirt: '#7A1F3D', shorts: '#FFFFFF', strength: 0.85, press: 'mid', squad: {
    GK: ['Alexandre Oukidja', 'Théo Percarpio', 'Koami Agbekponou'],
    DEF: ['Boubacar Fall', 'Kaïn Yandé', 'Kelvin Amian', 'Cheikh Sabaly', 'Aaron Kamardin'],
    MID: ['Kevin Ndoram', 'Ismaël Traoré', 'Amir Al Ammari', 'Lamine Cissé'],
    FWD: ['Georges Mikautadze', 'Ablie Jallow', 'Casimir Ninga', 'Christian Bassogog'],
  } },
  { name: 'Lorient', shirt: '#FF6600', shorts: '#FF6600', strength: 0.84, press: 'low', squad: {
    GK: ['Yvon Mvogo', 'Koffi Kouao', 'Paul Nardi'],
    DEF: ['Julien Laporte', 'Igor Silva', 'Montassar Talbi', 'Bamba Kanté', 'Wesley Lautoa'],
    MID: ['Pierre Ekwah', 'Aiyegun Tosin', 'Bamo Meïté', 'Enzo Lombardo'],
    FWD: ['Théo Le Bris', 'Ibrahima Koné', 'Sambou Soumano', 'Bathiste Guillaume'],
  } },
  { name: 'Paris FC', shirt: '#1A2E5A', shorts: '#1A2E5A', strength: 0.86, press: 'mid', squad: {
    GK: ['Obed Nkambadio', 'Wallef Meite', 'Lucas Lavigne'],
    DEF: ['Julien Le Cardinal', 'Ousseynou Niakaté', 'Otávio', 'Yoram Zague', 'Marius Broh'],
    MID: ['Ilan Kebbal', 'Sanka Marcelin', 'Gaëtan Weissbeck', 'Fankaty Dabo'],
    FWD: ['Nathanaël Mbuku', 'Nzuzi Toko', 'Julien Ponceau', 'Ryan Ovono'],
  } },
];

const BUNDESLIGA_TEAMS = [
  { name: 'Bayern Munich', shirt: '#DC052D', shorts: '#DC052D', strength: 1.17, press: 'high', squad: {
    GK: ['Manuel Neuer', 'Jonas Urbig', 'Daniel Peretz'],
    DEF: ['Dayot Upamecano', 'Min-jae Kim', 'Alphonso Davies', 'Josip Stanišić', 'Raphaël Guerreiro', 'Sacha Boey'],
    MID: ['Joshua Kimmich', 'Aleksandar Pavlović', 'Konrad Laimer', 'Leon Goretzka'],
    FWD: ['Harry Kane', 'Michael Olise', 'Jamal Musiala', 'Serge Gnabry', 'Kingsley Coman'],
  } },
  { name: 'Bayer Leverkusen', shirt: '#E32221', shorts: '#000000', strength: 1.08, press: 'high', squad: {
    GK: ['Mark Flekken', 'Lukáš Hrádecký', 'Niklas Lomb'],
    DEF: ['Jonathan Tah', 'Piero Hincapié', 'Álex Grimaldo', 'Nordi Mukiele', 'Edmond Tapsoba'],
    MID: ['Robert Andrich', 'Exequiel Palacios', 'Martin Terrier', 'Jonas Hofmann'],
    FWD: ['Patrik Schick', 'Victor Boniface', 'Amine Adli', 'Nathan Tella', 'Ernest Poku'],
  } },
  { name: 'Borussia Dortmund', shirt: '#FDE100', shorts: '#000000', strength: 1.06, press: 'high', squad: {
    GK: ['Gregor Kobel', 'Alexander Meyer', 'Marcel Lotka'],
    DEF: ['Nico Schlotterbeck', 'Waldemar Anton', 'Julian Ryerson', 'Ramy Bensebaini', 'Yan Couto'],
    MID: ['Marcel Sabitzer', 'Pascal Groß', 'Felix Nmecha', 'Jobe Bellingham', 'Salih Özcan'],
    FWD: ['Serhou Guirassy', 'Karim Adeyemi', 'Julien Duranville', 'Daniel Svensson'],
  } },
  { name: 'RB Leipzig', shirt: '#FFFFFF', shorts: '#FFFFFF', strength: 1.03, press: 'high', squad: {
    GK: ['Péter Gulácsi', 'Maarten Vandevoordt', 'Janis Blaswich'],
    DEF: ['Willi Orbán', 'Castello Lukeba', 'David Raum', 'Benjamin Henrichs', 'Lutsharel Geertruida'],
    MID: ['Xaver Schlager', 'Kevin Kampl', 'Assan Ouédraogo', 'Nicolas Seiwald'],
    FWD: ['Loïs Openda', 'Yan Diomande', 'Christoph Baumgartner', 'Antonio Nusa'],
  } },
  { name: 'Eintracht Frankfurt', shirt: '#000000', shorts: '#E2001A', strength: 0.99, press: 'high', squad: {
    GK: ['Kevin Trapp', 'Michael Zetterer', 'Kaua Santos'],
    DEF: ['Robin Koch', 'Arthur Theate', 'Nathaniel Brown', 'Aurélio Buta', 'Rasmus Kristensen'],
    MID: ['Hugo Larsson', 'Can Uzun', 'Ellyes Skhiri', 'Fares Chaibi'],
    FWD: ['Jonathan Burkardt', 'Ansgar Knauff', 'Nathan Amenyido', 'Michy Batshuayi'],
  } },
  { name: 'VfB Stuttgart', shirt: '#FFFFFF', shorts: '#E2001A', strength: 0.97, press: 'high', squad: {
    GK: ['Alexander Nübel', 'Fabian Bredlow', 'Dennis Seimen'],
    DEF: ['Jeff Chabot', 'Ramon Hendriks', 'Josha Vagnoman', 'Julian Chabot', 'Jamie Leweling'],
    MID: ['Angelo Stiller', 'Atakan Karazor', 'Chris Führich', 'Jeremy Sarmiento'],
    FWD: ['Deniz Undav', 'Ermedin Demirović', 'Tiago Tomás', 'Nick Woltemade'],
  } },
  { name: 'SC Freiburg', shirt: '#EC1C24', shorts: '#FFFFFF', strength: 0.94, press: 'mid', squad: {
    GK: ['Noah Atubolu', 'Florian Müller', 'Benjamin Uphoff'],
    DEF: ['Kiliann Sildillia', 'Matthias Ginter', 'Max Rosenfelder', 'Philipp Lienhart', 'Merveille Biankadi'],
    MID: ['Merlin Röhl', 'Vincenzo Grifo', 'Ritsu Doan', 'Yannik Keitel'],
    FWD: ['Junior Adamu', 'Michael Gregoritsch', 'Igor Matanović', 'Alex Sandqvist'],
  } },
  { name: 'Mainz 05', shirt: '#C3141E', shorts: '#FFFFFF', strength: 0.92, press: 'high', squad: {
    GK: ['Robin Zentner', 'Finn Dahmen', 'Lasse Rieß'],
    DEF: ['Andreas Hanche-Olsen', 'Stefan Bell', 'Anthony Caci', 'Maxim Leitsch', 'Danny da Costa'],
    MID: ['Nadiem Amiri', 'Jae-sung Lee', 'Dominik Kohr', 'Nelson Weiper'],
    FWD: ['Silas Katompa Mvumpa', 'Kaishu Sano', 'Paul Nebel', 'Marlon Mustapha'],
  } },
  { name: 'Borussia Mönchengladbach', shirt: '#000000', shorts: '#FFFFFF', strength: 0.93, press: 'mid', squad: {
    GK: ['Moritz Nicolas', 'Jonas Omlin', 'Jan Olschowsky'],
    DEF: ['Ko Itakura', 'Marvin Friedrich', 'Joe Scally', 'Fabio Chiarodia', 'Luca Netz'],
    MID: ['Rocco Reitz', 'Kevin Stöger', 'Franck Honorat', 'Julian Weigl', 'Robin Hack'],
    FWD: ['Tim Kleindienst', 'Nathan Ngoumou', 'Grant-Leon Ranos', 'Haris Tabaković'],
  } },
  { name: 'VfL Wolfsburg', shirt: '#65B32E', shorts: '#FFFFFF', strength: 0.91, press: 'mid', squad: {
    GK: ['Kamil Grabara', 'Marius Müller', 'Pavao Pervan'],
    DEF: ['Sebastiaan Bornauw', 'Cédric Zesiger', 'Aleksandar Pejčić', 'Kilian Fischer', 'Jenna Skibbe'],
    MID: ['Yannick Gerhardt', 'Maximilian Arnold', 'Patrick Wimmer', 'Lovro Majer'],
    FWD: ['Jonas Wind', 'Mohammed Amoura', 'Vaclav Cerny', 'Bartol Franjić'],
  } },
  { name: 'Union Berlin', shirt: '#EB1923', shorts: '#FFFFFF', strength: 0.90, press: 'high', squad: {
    GK: ['Frederik Rønnow', 'Alexander Schwolow', 'Luis Klatte'],
    DEF: ['Danilho Doekhi', 'Leopold Querfeld', 'Josip Juranović', 'Diogo Leite', 'Jerome Roussillon'],
    MID: ['Rani Khedira', 'Ilyas Ansah', 'Aljoscha Kemlein', 'Yorbe Vertessen'],
    FWD: ['Benedict Hollerbach', 'Andras Nemeth', 'Woo-yeong Jeong', 'Ivan Prtajin'],
  } },
  { name: 'Werder Bremen', shirt: '#009640', shorts: '#FFFFFF', strength: 0.90, press: 'mid', squad: {
    GK: ['Julian Pollersbeck', 'Mio Backhaus', 'Lukas Fahrnberger'],
    DEF: ['Marco Friedl', 'Amos Pieper', 'Anthony Jung', 'Julian Malatini', 'Mitchell Weiser'],
    MID: ['Romano Schmid', 'Leon Bell Bell', 'Skelly Alvero', 'Jens Stage'],
    FWD: ['Marvin Ducksch', 'Justin Njinmah', 'Rafael Borré', 'Derrick Köhn'],
  } },
  { name: 'FC Augsburg', shirt: '#BA3733', shorts: '#FFFFFF', strength: 0.88, press: 'low', squad: {
    GK: ['Nediljko Labrović', 'Tomáš Koubek', 'Dahmen Finn'],
    DEF: ['Robert Gumny', 'Jeffrey Gouweleeuw', 'Patric Pfeiffer', 'Chrislain Matsima', 'Keven Schlotterbeck'],
    MID: ['Elvis Rexhbeçaj', 'Fredrik Jensen', 'Arne Engels', 'Mert Kömür'],
    FWD: ['Phillip Tietz', 'Kelvin Yeboah', 'Alexis Claude-Maurice', 'Ermedin Bahtijaragić'],
  } },
  { name: 'TSG Hoffenheim', shirt: '#1961B5', shorts: '#FFFFFF', strength: 0.89, press: 'mid', squad: {
    GK: ['Oliver Baumann', 'Luca Philipp', 'Leo Weinkauf'],
    DEF: ['Ozan Kabak', 'Kevin Akpoguma', 'Bright Arrey-Mbi', 'David Jurásek', 'Kevin Vogt'],
    MID: ['Marius Bülter', 'Adam Hložek', 'Finn Ole Becker', 'Georginio Rutter'],
    FWD: ['Andrej Kramarić', 'Fisnik Asllani', 'Wanja Pröger', 'Tom Bischof'],
  } },
  { name: 'FC St. Pauli', shirt: '#6B4226', shorts: '#6B4226', strength: 0.86, press: 'high', squad: {
    GK: ['Nikola Vasilj', 'Lukas Krapf', 'Dennis Smarsch'],
    DEF: ['Eric Smith', 'Manolis Saliakas', 'Hauke Wahl', 'Karol Mets', 'Jackson Irvine'],
    MID: ['Oladapo Afolayan', 'Connor Metcalfe', 'Marcel Hartel', 'Terry Boss'],
    FWD: ['Elias Saad', 'Andreas Albers', 'Danel Sinani', 'Johannes Eggestein'],
  } },
  { name: 'FC Heidenheim', shirt: '#E2001A', shorts: '#0B1F4B', strength: 0.85, press: 'low', squad: {
    GK: ['Kevin Müller', 'Diant Ramaj', 'Vitus Eicher'],
    DEF: ['Benedikt Gimber', 'Patrick Mainka', 'Jan Schöppner', 'Marnon Busch', 'Omar Traoré'],
    MID: ['Adrian Beck', 'Lennard Maloney', 'Andreas Geipl', 'Kevin Sessa'],
    FWD: ['Marvin Pieringer', 'Sirlord Conteh', 'Budu Zivzivadze', 'Jan-Niklas Beste'],
  } },
  { name: '1. FC Köln', shirt: '#ED1C24', shorts: '#FFFFFF', strength: 0.87, press: 'mid', squad: {
    GK: ['Marvin Schwäbe', 'Philipp Pentke', 'Fynn Otto'],
    DEF: ['Timo Hübers', 'Julian Roloff', 'Justin Diehl', 'Joel Schmied', 'Luca Kilian'],
    MID: ['Eric Martel', 'Denis Huseinbašić', 'Linton Maina', 'Florian Kainz'],
    FWD: ['Jan Thielmann', 'Damion Downs', 'Said El Mala', 'Sargis Adamyan'],
  } },
  { name: 'Hamburger SV', shirt: '#0C2340', shorts: '#0C2340', strength: 0.86, press: 'mid', squad: {
    GK: ['Daniel Heuer Fernandes', 'Tom Mickel', 'Matheo Raab'],
    DEF: ['Miro Muheim', 'Guilherme Ramos', 'Rick van Drongelen', 'Noah Katterbach', 'Sebastian Schonlau'],
    MID: ['Ludovit Reis', 'Jean-Luc Dompé', 'Fabio Baukje', 'Immanuel Pherai'],
    FWD: ['Robert Glatzel', 'Ransford Königsdörffer', 'Davie Selke', 'Vuadi Bunga'],
  } },
];

// ALL_CLUBS: flat registry of every playable club across all six leagues,
// used only by Career mode (Play/Season/Cup/Practice keep indexing TEAMS
// directly, exactly as before - none of them ever touch this). Tag each
// club with its home league before concatenating so Career mode's league
// filters (buildCareerFixtures, generateLeagueTableEstimate, the transfer
// market, the club picker) all have something to filter on.
TEAMS.forEach(t => t.league = 'Premier League');
CHAMPIONSHIP_TEAMS.forEach(t => t.league = 'EFL Championship');
LA_LIGA_TEAMS.forEach(t => t.league = 'La Liga');
LIGUE1_TEAMS.forEach(t => t.league = 'Ligue 1');
BUNDESLIGA_TEAMS.forEach(t => t.league = 'Bundesliga');
SERIE_A_TEAMS.forEach(t => t.league = 'Serie A');
const ALL_CLUBS = [...TEAMS, ...CHAMPIONSHIP_TEAMS, ...LA_LIGA_TEAMS, ...LIGUE1_TEAMS, ...BUNDESLIGA_TEAMS, ...SERIE_A_TEAMS];
const CAREER_LEAGUES = ['Premier League', 'EFL Championship', 'La Liga', 'Ligue 1', 'Bundesliga', 'Serie A'];

// What each press style actually changes: dropMult scales defendTarget's
// "how far to drop off from home when out of possession" (below 1 = holds a
// higher line), pressCount is how many outfield players close the ball down
// (updatePressing) instead of the fixed 2 every team used before this.
const PRESS_STYLES = {
  high: { dropMult: 0.5, pressCount: 3 },
  mid:  { dropMult: 1.0, pressCount: 2 },
  low:  { dropMult: 1.6, pressCount: 1 },
};
const GK_COLORS = ['#a3e635', '#ec4899']; // home GK, away GK - kept neutral/contrasting regardless of club
// A spread of skin tones and hair colours, randomised per player at squad
// creation, so a team doesn't read as 11 identical clones of the same person.
const SKIN_TONES = ['#ffe0bd', '#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#5a3825'];
const HAIR_COLORS = ['#0b0b0b', '#2b1d10', '#5c3a21', '#7a4a1e', '#c9a24b', '#8a8a8a'];

// ---------- Formation (fractions, attacking toward x=1) ----------
const FORMATION = [
  { group: 'GK', x: 0.04, y: 0.50 },
  { group: 'DEF', x: 0.16, y: 0.15 },
  { group: 'DEF', x: 0.16, y: 0.38 },
  { group: 'DEF', x: 0.16, y: 0.62 },
  { group: 'DEF', x: 0.16, y: 0.85 },
  { group: 'MID', x: 0.42, y: 0.25 },
  { group: 'MID', x: 0.42, y: 0.50 },
  { group: 'MID', x: 0.42, y: 0.75 },
  { group: 'FWD', x: 0.68, y: 0.20 },
  { group: 'FWD', x: 0.68, y: 0.50 },
  { group: 'FWD', x: 0.68, y: 0.80 },
];

// ---------- Skill presets (apply to every AI-controlled player) ----------
// speed * pressBoost is kept below HUMAN_SPEED on every difficulty, so
// opponents never actually outrun you, even when they're pressing you - so
// the higher tiers lean mainly on sharper positioning (lower noise), faster
// decisions (lower reassess time), more committed tackling, longer shooting
// range, and (see DIFFICULTY_OPPONENT_BOOST below) tougher attributes, which
// aren't speed-capped and are what actually makes them bite.
// easy/medium are kept (existing saves may still reference them) but are no
// longer reachable from the rank tiles - Bronze through Champion were shifted
// two tiers harder (Bronze now plays at the old Gold/"hard" difficulty), and
// grandmaster/legend are two brand new tiers added above the old ceiling
// (champion) so there are still 6 selectable ranks - see the rank-tile
// data-skill attributes in index.html.
const SKILLS = {
  easy:      { speed: 4.4, pressBoost: 1.08, tackleChance: 0.40, noise: 3.0,  reassessMin: 0.70, reassessMax: 1.40, shootRange: 16 },
  medium:    { speed: 5.0, pressBoost: 1.10, tackleChance: 0.52, noise: 1.6,  reassessMin: 0.50, reassessMax: 1.00, shootRange: 20 },
  hard:      { speed: 5.6, pressBoost: 1.10, tackleChance: 0.62, noise: 0.6,  reassessMin: 0.30, reassessMax: 0.70, shootRange: 26 },
  expert:    { speed: 6.0, pressBoost: 1.12, tackleChance: 0.70, noise: 0.3,  reassessMin: 0.22, reassessMax: 0.50, shootRange: 30 },
  legendary: { speed: 6.4, pressBoost: 1.15, tackleChance: 0.76, noise: 0.15, reassessMin: 0.16, reassessMax: 0.35, shootRange: 34 },
  champion:  { speed: 6.6, pressBoost: 1.18, tackleChance: 0.80, noise: 0.08, reassessMin: 0.12, reassessMax: 0.28, shootRange: 36 },
  grandmaster: { speed: 6.8, pressBoost: 1.20, tackleChance: 0.84, noise: 0.05, reassessMin: 0.09, reassessMax: 0.22, shootRange: 38 },
  legend:      { speed: 7.0, pressBoost: 1.22, tackleChance: 0.87, noise: 0.03, reassessMin: 0.07, reassessMax: 0.18, shootRange: 40 },
};
const HUMAN_SPEED = 6.2;
// How fast a player's actual velocity can change (m/s^2) - both speeding up
// and braking are eased through this rather than snapping straight to the
// target speed, so studs have to overcome inertia/grip on the turf like a
// real sprint or stop would, instead of teleporting to a new velocity.
const PLAYER_ACCEL = 26;
const TACKLE_RADIUS = 1.6;
const TACKLE_RETRY_SEC = 0.9;
const PICKUP_RADIUS = 1.1;
const HUMAN_TACKLE_CHANCE = 0.65;
const PASS_MIN_SPEED = 9, PASS_MAX_SPEED = 23;
// Even a bare-minimum-charge shot (SHOT_MIN_SPEED) is faster than a
// fully-charged pass (PASS_MAX_SPEED), so a shot never feels weaker than a
// pass just because it wasn't held as long. Applies equally to both teams -
// releaseShot doesn't distinguish human vs AI.
const SHOT_MIN_SPEED = 24, SHOT_MAX_SPEED = 36;
const GK_SAVE_CHANCE = 0.35;
const GK_SPEED_MULT = 0.55; // goalkeepers move slower than outfield players
const GOAL_DEPTH = 2;       // how far into the net (metres) players/ball can enter, matches the drawn goal frame
const GK_SMOTHER_RADIUS = 1.8;
const GK_SMOTHER_CHANCE = 0.5;

// ---------- Camera (follows the ball, pulled slightly toward your player) ----------
const CAMERA_ZOOM = 1.6;
const CAMERA_FOLLOW_SPEED = 2.0; // how quickly the view catches up, per second
const CAMERA_DEADZONE = 2; // metres - small wobble (AI jitter, facing changes in a tackle) inside this radius is ignored, so the zoomed view doesn't shake

// ---------- Keybinds ----------
// A plain object (not const-frozen in spirit, just JS's normal mutability) -
// the Settings screen rebinds these in place, and every check elsewhere in
// the file compares against KEYS.xxx rather than a hardcoded letter, so a
// rebind takes effect everywhere immediately with no other code changes.
const KEYS = { up: 'w', down: 's', left: 'a', right: 'd', pass: 'j', shoot: 'k', tackle: 'l', switchPlayer: 'q', run: 'r', pause: 'p' };
const KEYBIND_LABELS = {
  up: 'Move Up', down: 'Move Down', left: 'Move Left', right: 'Move Right',
  pass: 'Pass (hold)', shoot: 'Shoot (hold)', tackle: 'Tackle',
  switchPlayer: 'Switch Player', run: 'Call Teammate Run', pause: 'Pause / Resume',
};

// Keeps the read-only key-hint table on the match screen's "Controls" panel
// in sync with whatever KEYS actually is right now (stock or rebound).
function updateKeyHints() {
  Object.keys(KEYBIND_LABELS).forEach(action => {
    const el = document.getElementById(`key-hint-${action}`);
    if (el) el.textContent = KEYS[action].toUpperCase();
  });
}

function renderKeybindList() {
  const el = document.getElementById('keybind-list');
  if (!el) return;
  el.innerHTML = Object.keys(KEYBIND_LABELS).map(action =>
    `<div class="keybind-row">
      <span>${KEYBIND_LABELS[action]}</span>
      <button class="keybind-btn" data-action="${action}">${KEYS[action].toUpperCase()}</button>
    </div>`
  ).join('');
  el.querySelectorAll('.keybind-btn').forEach(btn => {
    btn.onclick = () => startKeybindCapture(btn.dataset.action, btn);
  });
}

// Captures the very next keydown as the new binding for `action`. Runs in
// the capture phase and stops the event there (stopImmediatePropagation) so
// the same keypress can't also trigger the main game keydown handler (e.g.
// rebinding onto 'p' shouldn't also toggle pause on the spot). Escape cancels.
function startKeybindCapture(action, btn) {
  btn.textContent = 'Press a key…';
  btn.classList.add('listening');
  const handler = (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    window.removeEventListener('keydown', handler, true);
    if (e.key === 'Escape') { renderKeybindList(); return; }
    KEYS[action] = e.key.toLowerCase();
    saveSettings({ keys: Object.assign({}, loadSettings().keys, { [action]: KEYS[action] }) });
    renderKeybindList();
    updateKeyHints();
  };
  window.addEventListener('keydown', handler, true);
}

// ---------- Small helpers ----------
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function rand(lo, hi) { return lo + Math.random() * (hi - lo); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
function len(v) { return Math.hypot(v.x, v.y); }
function norm(v) { const l = len(v); return l < 1e-6 ? { x: 0, y: 0 } : { x: v.x / l, y: v.y / l }; }
function lerp(a, b, t) { return a + (b - a) * t; }

// Eases a player's velocity toward a target velocity at a limited rate
// (accel, in m/s^2) instead of snapping straight to it - used for both
// speeding up toward a movement target and braking toward a stop, so
// friction/grip is felt in both directions rather than just one.
function approachVelocity(p, targetVel, accel, dt) {
  const dvx = targetVel.x - p.vel.x, dvy = targetVel.y - p.vel.y;
  const dv = Math.hypot(dvx, dvy);
  const maxStep = accel * dt;
  if (dv <= maxStep || dv < 1e-6) {
    p.vel = { x: targetVel.x, y: targetVel.y };
  } else {
    p.vel = { x: p.vel.x + (dvx / dv) * maxStep, y: p.vel.y + (dvy / dv) * maxStep };
  }
}

const DIRT_SPRINT_SPEED = 4.5, DIRT_SPRINT_RATE = 2.5; // m/s threshold, flecks/sec while above it
const NIGHT_MATCH_CHANCE = 0.4; // rolled once per match/practice - see G.isNightMatch
const RAIN_CHANCE = 0.3; // rolled once per match/practice - see G.weather
const RAIN_DROP_COUNT = 140;
const RAIN_FRICTION_MULT = 0.7; // a wet pitch is skiddier - the ball loses speed more slowly, see updateBall

// ---------- Dirt/turf particles ----------
// Small transient flecks kicked up at a world position (x,y) - tackles get a
// bigger burst, sprinting feet get the occasional single fleck. Purely
// cosmetic, world-space so they track the camera the same way players do.
function spawnDirt(x, y, count, spread) {
  for (let i = 0; i < count; i++) {
    const ang = rand(0, Math.PI * 2);
    const spd = rand(0.5, 2.2);
    G.dirtParticles.push({
      x: x + rand(-spread, spread), y: y + rand(-spread, spread),
      vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
      life: 0, maxLife: rand(0.35, 0.6),
      size: rand(0.8, 1.6),
    });
  }
}
function updateDirtParticles(dt) {
  for (let i = G.dirtParticles.length - 1; i >= 0; i--) {
    const d = G.dirtParticles[i];
    d.life += dt;
    if (d.life >= d.maxLife) { G.dirtParticles.splice(i, 1); continue; }
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    const drag = 1 - Math.min(1, dt * 3);
    d.vx *= drag;
    d.vy *= drag;
  }
}
function drawDirtParticles(ctx) {
  for (const d of G.dirtParticles) {
    const t = d.life / d.maxLife;
    ctx.globalAlpha = 1 - t;
    ctx.fillStyle = '#6b4a2a';
    ctx.beginPath();
    ctx.arc(toCanvasX(d.x), toCanvasY(d.y), d.size * (1 - t * 0.3), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ---------- Weather ----------
// Rolled once per match/practice session, same idea as G.isNightMatch. Rain
// is purely a visual overlay plus a friction tweak in updateBall (RAIN_FRICTION_MULT)
// - kept deliberately simple rather than touching tackle/accuracy odds too,
// so match balance elsewhere isn't affected.
// forced ('rain'/'clear'), when given, skips the random roll - used by the
// online guest to match whatever the host actually rolled (see
// guestHandleMessage's matchStart handler) rather than rolling its own,
// independent weather that could disagree with what the host is showing.
function rollWeather(forced) {
  G.weather = forced || (Math.random() < RAIN_CHANCE ? 'rain' : 'clear');
  G.rainDrops = G.weather === 'rain'
    ? Array.from({ length: RAIN_DROP_COUNT }, () => ({
      x: rand(0, CANVAS_W), y: rand(0, CANVAS_H),
      speed: rand(650, 950), len: rand(10, 18),
    }))
    : [];
  const label = document.getElementById('weather-label');
  if (label) label.classList.toggle('hidden', G.weather !== 'rain');
}
function updateRain(dt) {
  if (G.weather !== 'rain' || G.reducedMotion) return;
  for (const d of G.rainDrops) {
    d.y += d.speed * dt;
    if (d.y > CANVAS_H) { d.y = -d.len; d.x = rand(0, CANVAS_W); }
  }
}
// Drawn in flat screen-space (transform reset, like drawRadar) rather than
// camera/world space, so the rain reads as falling evenly across the whole
// view regardless of the camera's current pan/zoom.
function drawRain(ctx) {
  if (G.weather !== 'rain' || G.reducedMotion) return;
  ctx.setTransform(canvasDPR, 0, 0, canvasDPR, 0, 0);
  ctx.strokeStyle = 'rgba(210,225,255,0.35)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (const d of G.rainDrops) {
    ctx.moveTo(d.x, d.y);
    ctx.lineTo(d.x - 3, d.y + d.len);
  }
  ctx.stroke();
}

// ---------- Sound effects (synthesized, no audio files needed) ----------
// AudioContext/SpeechSynthesis must be started from inside a real user
// gesture - call SFX.warmup() from a click handler before any other sound.
const SFX = (() => {
  let ctx = null;
  let masterGain = null;
  let muted = false;
  let volume = 1;
  try { muted = localStorage.getItem('zacFootballMuted') === 'true'; } catch (e) { /* localStorage unavailable - defaults to unmuted */ }
  try { const v = parseFloat(localStorage.getItem('zacFootballVolume')); if (!isNaN(v)) volume = clamp(v, 0, 1); } catch (e) { /* localStorage unavailable - defaults to full volume */ }
  function applyGain() { if (masterGain) masterGain.gain.value = muted ? 0 : volume; }
  function ensureCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = muted ? 0 : volume;
      masterGain.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function noiseBuffer(c, duration) {
    const n = Math.max(1, Math.floor(c.sampleRate * duration));
    const buffer = c.createBuffer(1, n, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }
  // A single looping crowd-murmur source, created once and reused for the
  // whole session - its gain is faded up/down rather than starting/stopping
  // the source (a Web Audio buffer source can only ever be started once).
  let ambience = null;
  function ensureCrowdAmbience() {
    if (ambience) return ambience;
    const c = ensureCtx();
    const source = c.createBufferSource();
    source.buffer = noiseBuffer(c, 3);
    source.loop = true;
    const filter = c.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 900;
    filter.Q.value = 0.6;
    const gain = c.createGain();
    gain.gain.value = 0;
    source.connect(filter).connect(gain).connect(masterGain);
    source.start(0);
    ambience = { gain };
    return ambience;
  }
  function tone(freq, duration, type, gainLevel, when) {
    const c = ensureCtx();
    const t0 = c.currentTime + (when || 0);
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(gainLevel, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.connect(gain).connect(masterGain);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }
  // pitch-bending tone, used for the vocal-ish "grunt" of a tackle
  function sweep(startFreq, endFreq, duration, type, gainLevel) {
    const c = ensureCtx();
    const t0 = c.currentTime;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(startFreq, t0);
    osc.frequency.exponentialRampToValueAtTime(endFreq, t0 + duration);
    gain.gain.setValueAtTime(gainLevel, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.connect(gain).connect(masterGain);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }
  // filtered noise burst - the basis for kick thuds, grunts and crowd noise
  function thud(duration, filterType, filterFreq, gainLevel, q) {
    const c = ensureCtx();
    const t0 = c.currentTime;
    const noise = c.createBufferSource();
    noise.buffer = noiseBuffer(c, duration);
    const filter = c.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = filterFreq;
    if (q) filter.Q.value = q;
    const gain = c.createGain();
    gain.gain.setValueAtTime(gainLevel, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    noise.connect(filter).connect(gain).connect(masterGain);
    noise.start(t0);
    return c;
  }
  return {
    warmup() { ensureCtx(); },
    kick() {
      // a low thud of struck-ball noise plus a short low thump underneath
      thud(0.09, 'lowpass', 900, 0.35);
      tone(95, 0.07, 'sine', 0.2, 0);
    },
    tackle() {
      // broadband noise burst (the collision) + a falling-pitch "grunt"
      thud(0.14, 'bandpass', 500, 0.3, 0.7);
      sweep(210, 90, 0.16, 'sawtooth', 0.16);
    },
    catch() {
      thud(0.1, 'lowpass', 1200, 0.25);
      tone(300, 0.08, 'triangle', 0.12, 0);
    },
    whistle() {
      // two close frequencies together give the "trill" of a real pea whistle
      tone(2050, 0.16, 'sine', 0.09, 0);
      tone(2200, 0.16, 'sine', 0.07, 0);
      tone(2050, 0.16, 'sine', 0.09, 0.22);
      tone(2200, 0.16, 'sine', 0.07, 0.22);
    },
    netHit() {
      // the ball thumping into taut netting - a soft low thump plus a fast
      // high-frequency "shhk" for the net rustling, distinct from a kick thud
      thud(0.16, 'lowpass', 350, 0.22);
      thud(0.22, 'highpass', 2400, 0.14, 0.6);
    },
    goal() {
      // layered crowd roar - a low rumble bed, a broadband cheering swell,
      // and top-end clapping/hiss texture - instead of one flat noise burst.
      thud(3, 'lowpass', 220, 0.28, 0.7);
      thud(3, 'bandpass', 1400, 0.24, 0.5);
      thud(2.4, 'highpass', 3000, 0.1, 0.8);
    },
    startCrowdAmbience() {
      const amb = ensureCrowdAmbience();
      const c = ensureCtx();
      amb.gain.gain.cancelScheduledValues(c.currentTime);
      amb.gain.gain.setTargetAtTime(0.05, c.currentTime, 0.5); // fades in to a low baseline murmur
    },
    stopCrowdAmbience() {
      if (!ambience) return;
      const c = ensureCtx();
      ambience.gain.gain.cancelScheduledValues(c.currentTime);
      ambience.gain.gain.setTargetAtTime(0, c.currentTime, 0.4);
    },
    // level is 0..1 - how "tense" the moment is (e.g. ball near a goal), eases
    // the crowd volume up from its baseline murmur toward a louder buzz
    setCrowdTension(level) {
      if (!ambience) return;
      const c = ensureCtx();
      ambience.gain.gain.setTargetAtTime(0.04 + clamp(level, 0, 1) * 0.09, c.currentTime, 0.3);
    },
    setMuted(v) {
      muted = v;
      try { localStorage.setItem('zacFootballMuted', v ? 'true' : 'false'); } catch (e) { /* localStorage unavailable - mute just won't persist */ }
      applyGain();
    },
    isMuted() { return muted; },
    setVolume(v) {
      volume = clamp(v, 0, 1);
      try { localStorage.setItem('zacFootballVolume', String(volume)); } catch (e) { /* localStorage unavailable - volume just won't persist */ }
      applyGain();
    },
    getVolume() { return volume; },
  };
})();

// Short haptic buzz on supported touchscreens - no-op everywhere else.
function vibrate(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

// Keeps a player inside the pitch, but lets them step into the goal mouth
// (within the goal's width) so a carried ball can actually cross the line.
function clampToPitch(pos) {
  const withinGoalY = Math.abs(pos.y - PITCH_WID / 2) <= GOAL_WIDTH / 2;
  const minX = withinGoalY ? -GOAL_DEPTH : 0.2;
  const maxX = withinGoalY ? PITCH_LEN + GOAL_DEPTH : PITCH_LEN - 0.2;
  pos.x = clamp(pos.x, minX, maxX);
  pos.y = clamp(pos.y, 0.2, PITCH_WID - 0.2);
}

// Picks white or near-black text so a team name stays readable when printed
// directly on that team's own (sometimes light, e.g. yellow) shirt colour.
function readableTextColor(hex) {
  const c = hex.replace('#', '');
  const r = parseInt(c.substr(0, 2), 16), g = parseInt(c.substr(2, 2), 16), b = parseInt(c.substr(4, 2), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? '#111111' : '#ffffff';
}

// True if two shirt colours would be hard to tell apart at a glance on the
// pitch - plain RGB distance is cheap and good enough for this; no need for
// a perceptual colour space just to decide whether to switch kits. Mutable
// (not const) since the Settings screen's kit-clash sensitivity control
// raises this for players who want a more cautious/colourblind-friendly cutoff.
let KIT_CLASH_THRESHOLD = 110;
const KIT_CLASH_NORMAL = 110, KIT_CLASH_HIGH = 170;
// Separate "Colour-blind" mode (Settings > Kit Clash Sensitivity) - plain RGB
// distance isn't a good proxy for red-green colour blindness (the most common
// form): two kits can be far apart in raw RGB yet still collapse toward each
// other once the red/green split stops carrying information, e.g. a red shirt
// vs a similarly-bright green one. Folding R and G into one combined "warm"
// channel and weighting blue (the axis red-green colour blindness leaves
// intact) approximates that collapse well enough for a gameplay heuristic -
// it isn't a full colorimetric simulation, just tuned by hand against this
// game's own kit colours to catch the risky pairs without over-flagging.
let KIT_CLASH_COLORBLIND = false;
const KIT_CLASH_CB_THRESHOLD = 145;
function kitsClash(hexA, hexB) {
  const a = hexA.replace('#', ''), b = hexB.replace('#', '');
  const ar = parseInt(a.substr(0, 2), 16), ag = parseInt(a.substr(2, 2), 16), ab = parseInt(a.substr(4, 2), 16);
  const br = parseInt(b.substr(0, 2), 16), bg = parseInt(b.substr(2, 2), 16), bb = parseInt(b.substr(4, 2), 16);
  if (KIT_CLASH_COLORBLIND) {
    const warmA = ar + ag, warmB = br + bg;
    return Math.hypot(warmA - warmB, (ab - bb) * 2) < KIT_CLASH_CB_THRESHOLD;
  }
  return Math.hypot(ar - br, ag - bg, ab - bb) < KIT_CLASH_THRESHOLD;
}

// ---------- Toast notifications (fouls, cards, offside) ----------
// A simple queue so an offside call and a card given moments later don't
// stomp on each other - each one gets its own 1.6s on screen.
const toastQueue = [];
let toastBusy = false;
// Every foul/card/offside/injury/goal notification already funnels through
// this one function - broadcasting here (rather than at each individual call
// site) covers all of them for free. Guest calling this locally (from a
// message it received) doesn't re-broadcast, since its own role isn't host.
function showToast(text, color) {
  toastQueue.push({ text, color });
  if (!toastBusy) processToastQueue();
  if (G.online && G.online.role === 'host') sendOnlineMessage({ type: 'toast', text, color });
}
function processToastQueue() {
  if (!toastQueue.length) { toastBusy = false; return; }
  toastBusy = true;
  const { text, color } = toastQueue.shift();
  const el = document.getElementById('toast-banner');
  el.textContent = text;
  el.style.setProperty('--toast-color', color);
  el.classList.add('show');
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(processToastQueue, 250);
  }, 1600);
}

// ---------- In-match event ticker ----------
// A short-lived toast is easy to miss - this keeps the last few goals/cards/
// subs visible in one place instead of only flashing on screen once.
const EVENT_LOG_MAX = 5;
function logMatchEvent(text) {
  G.eventLog.unshift({ text });
  if (G.eventLog.length > EVENT_LOG_MAX) G.eventLog.length = EVENT_LOG_MAX;
  const el = document.getElementById('event-ticker');
  if (el) el.innerHTML = G.eventLog.map(e => `<div class="ticker-row">${e.text}</div>`).join('');
  if (G.online && G.online.role === 'host') sendOnlineMessage({ type: 'event', text });
}

// A hard shot or a successful tackle gives the pitch a quick jolt.
function shakeScreen() {
  if (G.reducedMotion) return;
  const el = document.getElementById('pitch-wrap');
  el.classList.remove('screen-shake');
  void el.offsetWidth; // force reflow so the animation restarts if already running
  el.classList.add('screen-shake');
}

// ============================================================
// Game state
// ============================================================
const STATE = { MENU: 'MENU', SETUP: 'SETUP', PLAYING: 'PLAYING', PAUSED: 'PAUSED', GOAL: 'GOAL', HALFTIME: 'HALFTIME', FULLTIME: 'FULLTIME', SHOOTOUT: 'SHOOTOUT', PRACTICE: 'PRACTICE' };
const GOAL_CELEBRATION_SEC = 3375; // ms despite the name - 3/4 of the old 4500ms length

const G = {
  state: STATE.MENU,
  teams: [null, null],       // teams[0] is always the human team
  ball: { pos: { x: PITCH_LEN / 2, y: PITCH_WID / 2 }, vel: { x: 0, y: 0 }, owner: null, lastTouchTeam: 0, lastToucher: null, kickImmuneFrom: null, kickImmuneUntil: 0, spin: 0 },
  controlled: null,
  controlled2: null, // host-only: team 1's controlled player, driven by the online guest - see autoAssignControl/applyGuestMoveInput
  remoteInput: { move: { x: 0, y: 0 } }, // host-only: guest's latest input, fed by incoming 'move' messages - see hostHandleMessage
  lastGuestMove: { x: 0, y: 0 }, // guest-only: the vector it's currently sending, for interpolateShadowState's cosmetic dead-reckoning nudge
  skill: SKILLS.medium,
  half: 1,
  elapsedSec: 0,
  halfLengthSec: 120,
  displayedSec: -1,
  addedTimeSec: 0, // computed once normal time expires - see computeAddedTime()
  addedTimeAnnounced: false,
  stoppageEvents: 0, // fouls/goals/subs so far this half - drives computeAddedTime()
  extraTime: false, // cup ties only - true once a drawn match has gone to extra time
  etHalf: 0, // 1 or 2, which extra-time half is being played
  halftimeInterval: null,
  fulltimeTimeout: null,
  goalTimeout: null,
  confettiTimeouts: [],
  netRipple: null, // { dir, y, t } - set on a goal, decays away in drawPitchMarkings via netRippleOffset()
  dirtParticles: [], // transient turf flecks kicked up by tackles/sprinting - see spawnDirt()
  isNightMatch: false, // rolled once per match/practice session - see NIGHT_MATCH_CHANCE
  weather: 'clear', // 'clear' or 'rain' - rolled once per match/practice session, see rollWeather()
  rainDrops: [], // falling rain streaks while G.weather === 'rain' - see rollWeather/updateRain/drawRain
  reducedMotion: false, // Settings > Accessibility > Reduce Motion - only gates visual flourish (shake/confetti/rain streaks), never gameplay (rain still slows the ball)
  customizeControls: false, // Settings > Touch Controls > Customize Positions - see setupControlsCustomization
  online: null, // null offline; else {role:'host'|'guest', pc, dc, signalWs, connState, matchStarted, ...} - see startOnlineHost/joinOnlineWithCode
  pendingScorer: null, // player object captured at the moment of a goal - see triggerGoalSlowMo/scoreGoal
  allMatchPlayers: [], // every player who's appeared this match (starters + subs brought on) - for Man of the Match at full-time
  eventLog: [], // recent goals/cards/subs shown in the in-match ticker - see logMatchEvent()
  keysDown: {},
  stats: { shots: [0, 0], shotsOnTarget: [0, 0], tackles: [0, 0], fouls: [0, 0], corners: [0, 0], possession: [0, 0] },
  charge: { pass: false, shoot: false, passStart: 0, shootStart: 0 },
  joystick: { x: 0, y: 0 }, // analog vector from the on-screen joystick (or a gamepad stick), each axis in [-1, 1]
  gamepadButtons: {}, // last frame's button-pressed state, for edge detection
  gamepadWasActive: false,
  restart: null, // { taker, center:{x,y}, exclusion, kind } while a kickoff/throw-in/corner/goal kick is pending
  goalPending: false, // true during the brief slow-mo window right after a goal is struck, before the celebration fires
  goalEndDir: null, // 1 or -1, which end the pending goal is at - tells the net which way to "catch" the ball
  slowMoFactor: 1,
  slowMoTimeout: null,
  replayBuffer: [], // rolling ~1.5s of recent player/ball positions, for the goal-replay clip - see recordReplayFrame()
  replay: { active: false, frames: null, idx: 0, restoreState: null, everyOther: false, onDone: null }, // see scoreGoal/stepGoalReplay
  lastTs: 0,
  camera: { x: PITCH_LEN / 2, y: PITCH_WID / 2, zoom: CAMERA_ZOOM },
  lastTensionUpdate: 0,
  shotAim: 0, // -1 (left post) .. 1 (right post), steered while charging a penalty/free kick/practice shot
};

// True whenever the human's current shot is one they can actually steer
// (a placed dead ball), rather than an instinctive open-play strike -
// penalties/free kicks they're taking, or any practice attempt. forPlayer
// defaults to G.controlled (every existing call site) - the online guest's
// own guestSteerAim passes G.controlled explicitly too, since for the
// guest that already means "my own player" (see interpolateShadowState).
function isAimableShotSituation(forPlayer) {
  const p = forPlayer || G.controlled;
  if (G.state === STATE.PRACTICE) return true;
  return !!(G.restart && p === G.restart.taker && (G.restart.kind === 'penalty' || G.restart.kind === 'freekick'));
}

// The opponent (team index 1) gets an extra attribute boost on top of their
// real team strength as difficulty rises - your own team (index 0) always
// just plays at its real strength, whichever club you picked.
const DIFFICULTY_OPPONENT_BOOST = { easy: 1.0, medium: 1.08, hard: 1.18, expert: 1.30, legendary: 1.45, champion: 1.55, grandmaster: 1.65, legend: 1.75 };

// Shared by both the 11 starters (which have a real formation slot/home
// position) and the bench (which don't have either until they're subbed on).
function makeSquadPlayer(idx, group, slot, attackDir, teamFactor) {
  return {
    idx,
    group,
    isGK: group === 'GK',
    slot,
    home: { x: 0, y: 0 },
    pos: { x: 0, y: 0 },
    vel: { x: 0, y: 0 },
    facing: { x: attackDir, y: 0 },
    pressing: false,
    decisionTimer: rand(0.4, 1.0),
    lastTackleTry: -10,
    noiseSeed: Math.random() * 1000,
    runTimer: rand(2, 4), // countdown to the next automatic AI attacking run
    // Individual variance around the team's real overall quality, with the
    // opponent's additionally scaled up by the difficulty boost above.
    pace: clamp(rand(0.9, 1.1) * teamFactor, 0.7, 1.45),
    tackling: clamp(rand(0.85, 1.15) * teamFactor, 0.6, 1.5),
    finishing: clamp(rand(0.85, 1.15) * teamFactor, 0.6, 1.5),
    reflexes: clamp(rand(0.85, 1.15) * teamFactor, 0.6, 1.5), // only meaningful for the goalkeeper
    cardLevel: 0, // 0 = clean, 1 = yellow, 2 = sent off (red)
    sentOff: false,
    stamina: 1, // 1 = fresh, drains with sprinting/pressing over the match - see drainStamina()
    injured: false, // picked up a knock in a tackle - see maybeInjurePlayer(); lasts the rest of the match
    skinTone: SKIN_TONES[Math.floor(Math.random() * SKIN_TONES.length)],
    hairColor: HAIR_COLORS[Math.floor(Math.random() * HAIR_COLORS.length)],
    goals: 0, // this match only - see scoreGoal(); resets naturally since players are rebuilt each initMatch
    matchTackles: 0, // this match only - see aiTackleAttempt/tryHumanTackle
    realName: null, // only set for the human's own team, and only if that club has squad data - see assignRealNames()
  };
}

// 5-player bench: a backup keeper plus a spread of outfield cover - enough
// to make a substitution for almost any position without over-complicating
// squad selection with a screen of its own.
const BENCH_TEMPLATE = ['GK', 'DEF', 'DEF', 'MID', 'FWD'];
const MAX_SUBS = 5;

function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Real player names are only ever shown for the human's own team (see the
// teamIdx check in buildTeam) - the AI opponent keeps the generic "role +
// number" label, same as before. The starting XI gets the first name drawn
// per position group; the bench (see BENCH_TEMPLATE) draws further names
// from the same shuffled pool, so it's a genuine random subset of the rest
// of the squad and not always the same five reserves match after match.
function assignRealNames(team, def) {
  if (!def.squad) return;
  const pools = {};
  const used = {};
  for (const group of Object.keys(def.squad)) { pools[group] = shuffled(def.squad[group]); used[group] = 0; }
  for (const p of [...team.players, ...team.bench]) {
    const pool = pools[p.group];
    if (pool && used[p.group] < pool.length) p.realName = pool[used[p.group]++];
  }
}

function buildTeam(def, attackDir, gkColor, teamIdx, skillKey, kit) {
  const boost = teamIdx === 1 ? (DIFFICULTY_OPPONENT_BOOST[skillKey] || 1) : 1;
  const teamFactor = (def.strength || 1) * boost;
  const players = FORMATION.map((slot, i) => makeSquadPlayer(i, slot.group, slot, attackDir, teamFactor));
  const bench = BENCH_TEMPLATE.map((group, i) => makeSquadPlayer(100 + i, group, null, attackDir, teamFactor));
  const useKit = kit || def;
  const team = {
    def, attackDir, score: 0,
    shirt: useKit.shirt, shorts: useKit.shorts, gkColor,
    pressStyle: def.press || 'mid',
    players, bench, subsRemaining: MAX_SUBS,
  };
  if (teamIdx === 0) assignRealNames(team, def);
  return team;
}

function computeHomePositions(team) {
  for (const p of team.players) {
    const fx = team.attackDir === 1 ? p.slot.x : 1 - p.slot.x;
    p.home.x = fx * PITCH_LEN;
    p.home.y = p.slot.y * PITCH_WID;
  }
}

// Snaps players back to their formation spot, but keeps everyone in their own
// half - the formation shape itself (home.x) can push forwards past halfway
// for open play, which isn't valid at a kickoff/restart.
function placeAtHome(team) {
  const halfway = PITCH_LEN / 2;
  for (const p of team.players) {
    p.pos.x = team.attackDir === 1 ? Math.min(p.home.x, halfway - 0.5) : Math.max(p.home.x, halfway + 0.5);
    p.pos.y = p.home.y;
    p.vel = { x: 0, y: 0 };
  }
}

function outfield(team) { return team.players.filter(p => !p.isGK && !p.sentOff); }

// ---------- Stamina ----------
// Drain is scaled against the half length rather than real seconds, since
// half length is really a pacing/difficulty setting here, not a literal
// match duration - this keeps a 1-minute half and a 10-minute half draining
// players by roughly the same relative amount by full time. Goalkeepers
// barely move, so they're exempt. Never fully empties - a gassed player is
// slower, not frozen.
const STAMINA_DRAIN = 0.5;
function drainStamina(p, dt, activityMultiplier) {
  if (p.isGK) return;
  const frac = dt / G.halfLengthSec;
  p.stamina = clamp(p.stamina - frac * activityMultiplier * STAMINA_DRAIN, 0.2, 1);
}

// ---------- Substitutions ----------
// The incoming bench player inherits the outgoing player's role (formation
// slot, current position/home) so the team's shape doesn't break - only
// their own attributes and (fresh, clean) card status come with them.
function substitutePlayer(team, onPitchPlayer, benchPlayer) {
  G.stoppageEvents++;
  benchPlayer.idx = onPitchPlayer.idx;
  benchPlayer.group = onPitchPlayer.group;
  benchPlayer.isGK = onPitchPlayer.isGK;
  benchPlayer.slot = onPitchPlayer.slot;
  benchPlayer.home = { x: onPitchPlayer.home.x, y: onPitchPlayer.home.y };
  benchPlayer.pos = { x: onPitchPlayer.pos.x, y: onPitchPlayer.pos.y };
  benchPlayer.vel = { x: 0, y: 0 };
  benchPlayer.facing = { x: onPitchPlayer.facing.x, y: onPitchPlayer.facing.y };
  benchPlayer.pressing = false;
  benchPlayer.decisionTimer = rand(0.4, 1.0);
  benchPlayer.lastTackleTry = -10;
  benchPlayer.runTimer = rand(2, 4);
  benchPlayer.__team = onPitchPlayer.__team;
  const pitchIdx = team.players.indexOf(onPitchPlayer);
  team.players[pitchIdx] = benchPlayer;
  team.bench = team.bench.filter(p => p !== benchPlayer);
  team.subsRemaining--;
  // Fix up anything still pointing at the player who just came off.
  if (G.ball.owner === onPitchPlayer) G.ball.owner = benchPlayer;
  if (G.ball.lastToucher === onPitchPlayer) G.ball.lastToucher = benchPlayer;
  if (G.ball.kickImmuneFrom === onPitchPlayer) G.ball.kickImmuneFrom = benchPlayer;
  if (G.restart && G.restart.taker === onPitchPlayer) G.restart.taker = benchPlayer;
  if (G.controlled === onPitchPlayer) G.controlled = benchPlayer;
  updateCardIndicators();
  G.allMatchPlayers.push(benchPlayer);
  const teamName = document.getElementById(benchPlayer.__team === 0 ? 'score-home-name' : 'score-away-name').textContent;
  logMatchEvent(`🔄 ${teamName} - ${playerLabel(benchPlayer)} on for ${playerLabel(onPitchPlayer)}`);
}

// A light touch of AI squad management: at half-time, sub off the first
// yellow-carded AI player it finds (avoiding the red-card/down-to-10 risk),
// matching the position where possible. Human subs are handled interactively
// via the substitutions screen instead.
function aiAutoSub(team) {
  if (team.subsRemaining <= 0 || !team.bench.length) return;
  const carded = team.players.find(p => p.cardLevel === 1);
  if (!carded) return;
  const replacement = team.bench.find(p => p.group === carded.group) || team.bench[0];
  substitutePlayer(team, carded, replacement);
}

const GROUP_LABEL = { GK: 'Goalkeeper', DEF: 'Defender', MID: 'Midfielder', FWD: 'Forward' };
// Players don't have names in this game - a role + squad number (matching
// the label already used on the substitutions screen) stands in for one.
function playerLabel(p) { return p.realName || `${GROUP_LABEL[p.group] || p.group} ${p.idx + 1}`; }

// Updates the small expandable yellow/red-card badge next to each team name
// on the scoreboard - only counts players still ON the pitch with a single
// yellow (a second yellow sends them off, at which point subbing them is
// moot - they're already out of the match).
function updateCardIndicators() {
  [0, 1].forEach(t => {
    const side = t === 0 ? 'home' : 'away';
    const team = G.teams[t];
    const carded = team ? team.players.filter(p => p.cardLevel === 1) : [];
    const btn = document.getElementById(`cards-${side}-btn`);
    const countEl = document.getElementById(`cards-${side}-count`);
    const listEl = document.getElementById(`cards-${side}-list`);
    countEl.textContent = carded.length;
    btn.classList.toggle('hidden', carded.length === 0);
    if (carded.length === 0) listEl.classList.add('hidden');
    listEl.innerHTML = carded.map(p => `<div>${GROUP_LABEL[p.group] || p.group} ${p.idx + 1} - consider a sub</div>`).join('');
  });
}

// ---------- Substitutions screen (human team only - see aiAutoSub for the AI side) ----------
let pendingSubOut = null; // the on-pitch player selected via "Sub Off", waiting for a bench pick

function renderSubsScreen() {
  const team = G.teams[0];
  document.getElementById('subs-remaining').textContent = `Substitutions remaining: ${team.subsRemaining}`;

  document.getElementById('subs-onpitch').innerHTML = team.players.map(p => {
    const cardBadge = p.cardLevel === 1 ? ' \u{1F7E8}' : p.cardLevel === 2 ? ' \u{1F7E5}' : '';
    const injuryBadge = p.injured ? ' \u{1FA79}' : '';
    const selected = p === pendingSubOut ? ' sub-row-selected' : '';
    const noSubsLeft = team.subsRemaining <= 0;
    return `<div class="sub-row${selected}">
      <span>${playerLabel(p)}${cardBadge}${injuryBadge}</span>
      <button class="sub-off-btn" data-idx="${p.idx}" ${noSubsLeft ? 'disabled' : ''}>${p === pendingSubOut ? 'Selected' : 'Sub Off'}</button>
    </div>`;
  }).join('');

  document.getElementById('subs-bench').innerHTML = team.bench.map((p, i) => {
    const enabled = pendingSubOut && team.subsRemaining > 0;
    return `<div class="sub-row">
      <span>${playerLabel(p)} (${GROUP_LABEL[p.group] || p.group})</span>
      <button class="sub-on-btn" data-bench="${i}" ${enabled ? '' : 'disabled'}>Bring On</button>
    </div>`;
  }).join('');

  document.getElementById('subs-bench-hint').classList.toggle('hidden', !!pendingSubOut || team.subsRemaining <= 0);
}

// ---------- Kickoff / restarts ----------
// Generic restart lock used for kickoffs, throw-ins, corners and goal kicks:
// the taker is teleported to the restart spot and can only pass (no
// dribble/shoot) until they release the ball; everyone else must stay
// outside an exclusion zone around that spot, same idea as the real laws.
function beginRestart(taker, spot, exclusion, kind) {
  G.shotAim = 0; // re-centre the aim marker for whoever's about to take this (harmless for restarts nobody aims, e.g. a throw-in)
  taker.pos.x = clamp(spot.x, 0.2, PITCH_LEN - 0.2);
  taker.pos.y = clamp(spot.y, 0.2, PITCH_WID - 0.2);
  // Face inward toward the pitch centre. The taker is placed right at the
  // boundary, and the ball renders 0.35m ahead of them in their facing
  // direction - without this, their stale facing from before (possibly
  // pointing outward) could make the ball immediately render back out of
  // bounds, which got misread as a fresh out-of-bounds event and overturned
  // the restart just given (e.g. a corner flipping into a goal kick).
  const inward = sub(CENTER_POS, taker.pos);
  if (len(inward) > 0.01) taker.facing = norm(inward);
  taker.decisionTimer = rand(0.35, 0.75); // how long an AI taker waits before releasing it
  G.ball.owner = taker;
  G.ball.pos = { x: taker.pos.x, y: taker.pos.y };
  G.ball.vel = { x: 0, y: 0 };
  G.ball.lastTouchTeam = taker.__team;
  G.ball.kickImmuneFrom = null;
  G.restart = { taker, center: { x: taker.pos.x, y: taker.pos.y }, exclusion, kind };
  // At a throw-in, send the nearest teammate in to offer a close outlet -
  // closer than the opponents' exclusion line allows them to stand, but not
  // right on top of the thrower either.
  if (kind === 'throwin') {
    const team = G.teams[taker.__team];
    const supporter = team.players.filter(p => p !== taker && !p.isGK)
      .sort((a, b) => dist(a.pos, taker.pos) - dist(b.pos, taker.pos))[0];
    if (supporter) {
      const supportDist = Math.max(1.5, exclusion - 2.5);
      const inwardY = taker.pos.y < PITCH_WID / 2 ? taker.pos.y + supportDist : taker.pos.y - supportDist;
      supporter.supportTarget = { x: taker.pos.x, y: clamp(inwardY, 0.5, PITCH_WID - 0.5) };
    }
  }
  autoAssignControl();
}

// Finds whichever of a team's players is nearest the restart spot and has
// them take it (used for throw-ins and corners, where any nearby player -
// not a fixed formation slot - would realistically take the restart).
function startTeamRestart(teamIdx, spot, exclusion, kind) {
  const team = G.teams[teamIdx];
  const taker = team.players.slice().sort((a, b) => dist(a.pos, spot) - dist(b.pos, spot))[0];
  beginRestart(taker, spot, exclusion, kind);
}

function doKickoff(kickingIdx) {
  SFX.whistle();
  for (const team of G.teams) { computeHomePositions(team); placeAtHome(team); }
  const kicker = G.teams[kickingIdx].players.find(p => p.group === 'MID' && Math.abs(p.slot.y - 0.5) < 0.01) || outfield(G.teams[kickingIdx])[0];
  beginRestart(kicker, CENTER_POS, CENTER_CIRCLE_R + 0.3, 'kickoff');
}

// ---------- Fouls, cards, free kicks & penalties ----------
const FOUL_CHANCE = 0.12;  // of a MISSED tackle attempt
const CARD_CHANCE = 0.25;  // of a foul also being cautionable

// A hard challenge has a small chance of leaving the dispossessed player with
// a lasting knock - a permanent pace/tackling hit for the rest of the match,
// same idea as a niggle that never quite gets shaken off. Gives the sub
// system a reason to be used mid-match beyond just yellow cards.
const INJURY_CHANCE = 0.05;
function maybeInjurePlayer(p) {
  if (!p || p.isGK || p.injured || Math.random() >= INJURY_CHANCE) return;
  p.injured = true;
  p.pace *= 0.8;
  p.tackling *= 0.85;
  G.stoppageEvents++;
  const teamName = document.getElementById(p.__team === 0 ? 'score-home-name' : 'score-away-name').textContent;
  showToast(`🤕 ${teamName} player picked up a knock`, '#f97316');
  logMatchEvent(`🤕 ${teamName} - ${playerLabel(p)} picked up a knock`);
}

// A missed tackle has a small chance of being adjudicated as a foul instead
// of just a clean miss - awards a penalty (if inside the defender's own box)
// or a direct free kick (anywhere else) to the team that was fouled.
function maybeCallFoul(defender, spot) {
  if (defender.sentOff || Math.random() >= FOUL_CHANCE) return;
  const defTeam = G.teams[defender.__team];
  const attackTeamIdx = 1 - defender.__team;
  const ownGoalX = defTeam.attackDir === 1 ? 0 : PITCH_LEN;
  const inOwnBox = Math.abs(spot.x - ownGoalX) <= BOX_DEPTH && Math.abs(spot.y - PITCH_WID / 2) <= BOX_WIDTH / 2;
  G.stats.fouls[defender.__team]++;
  G.stoppageEvents++;
  cardCheck(defender);
  SFX.whistle();
  const foulTeamName = document.getElementById(defender.__team === 0 ? 'score-home-name' : 'score-away-name').textContent;
  if (inOwnBox) {
    showToast('🎯 PENALTY!', '#e63946');
    logMatchEvent(`🎯 Penalty - ${foulTeamName} - ${playerLabel(defender)}`);
    const attackTeam = G.teams[attackTeamIdx];
    const penX = attackTeam.attackDir === 1 ? PITCH_LEN - PEN_SPOT_DIST : PEN_SPOT_DIST;
    const taker = outfield(attackTeam).slice().sort((a, b) => b.finishing - a.finishing)[0];
    beginRestart(taker, { x: penX, y: PITCH_WID / 2 }, BOX_DEPTH, 'penalty');
  } else {
    showToast(pick(['🚩 FOUL - Free Kick', '🚩 Free Kick Given', '🚩 Whistle - Free Kick']), '#eab308');
    logMatchEvent(`🚩 Foul - ${foulTeamName} - ${playerLabel(defender)}`);
    const clampedSpot = { x: clamp(spot.x, 3, PITCH_LEN - 3), y: clamp(spot.y, 2, PITCH_WID - 2) };
    startTeamRestart(attackTeamIdx, clampedSpot, CORNER_EXCLUSION, 'freekick');
  }
}

// Tracks cautions per player through the match: a second yellow sends them
// off for the rest of it (they stay on the pitch but stop participating).
function cardCheck(defender) {
  if (Math.random() >= CARD_CHANCE) return;
  defender.cardLevel++;
  const teamName = document.getElementById(defender.__team === 0 ? 'score-home-name' : 'score-away-name').textContent;
  if (defender.cardLevel === 1) {
    showToast(pick(['🟨 YELLOW CARD', "🟨 Booking - It's a Yellow", '🟨 Cautioned']), '#ffd54f');
    logMatchEvent(`🟨 ${teamName} - ${playerLabel(defender)}`);
  } else {
    defender.sentOff = true;
    showToast('🟥 RED CARD - down to 10 men!', '#e63946');
    logMatchEvent(`🟥 ${teamName} - ${playerLabel(defender)}`);
  }
  updateCardIndicators();
}

// While a restart is pending, opponents must stay outside the exclusion zone
// (same idea as the real laws); kickoffs additionally push back the taker's
// own teammates too (everyone must be in their own half). Throw-ins, corners
// and goal kicks only hold back the opposing team - your own teammates are
// free to stand close by as a safe outlet, same as in real football.
function applyRestartRestraint(p, team) {
  if (!G.restart || p === G.restart.taker) return;
  const { center, exclusion, kind, taker } = G.restart;
  const halfway = PITCH_LEN / 2;
  const isTeammate = p.__team === taker.__team;
  if (kind === 'penalty' && p.isGK && !isTeammate) return; // the keeper has to stay in goal to have a chance
  if (kind === 'kickoff') {
    if (team.attackDir === 1) p.pos.x = Math.min(p.pos.x, halfway - 0.3);
    else p.pos.x = Math.max(p.pos.x, halfway + 0.3);
  } else if (isTeammate) {
    return;
  }
  const toP = sub(p.pos, center);
  const d = len(toP);
  if (d < exclusion) {
    const dir = d < 1e-6 ? { x: team.attackDir === 1 ? -1 : 1, y: 0 } : { x: toP.x / d, y: toP.y / d };
    p.pos.x = center.x + dir.x * exclusion;
    p.pos.y = center.y + dir.y * exclusion;
    if (kind === 'kickoff') {
      if (team.attackDir === 1) p.pos.x = Math.min(p.pos.x, halfway - 0.3);
      else p.pos.x = Math.max(p.pos.x, halfway + 0.3);
    }
  }
  clampToPitch(p.pos);
}

// AI taker: wait a beat then release it - never shoots or dribbles off a restart spot.
function handleRestartTaker(p, team, dt) {
  p.decisionTimer -= dt;
  if (p.decisionTimer > 0) return;
  if (G.restart.kind === 'penalty') {
    releaseShot(p, team, rand(0.7, 1));
    return;
  }
  if (G.restart.kind === 'freekick') {
    const goalX = team.attackDir === 1 ? PITCH_LEN : 0;
    const goalY = PITCH_WID / 2;
    if (dist(p.pos, { x: goalX, y: goalY }) < G.skill.shootRange) {
      releaseShot(p, team, rand(0.6, 0.9));
      return;
    }
  }
  releasePass(p, team, rand(0.55, 0.9));
}

// Team 1's assignment (G.controlled2) is folded into this same function -
// called from every existing call site automatically - rather than hunting
// down and duplicating each call site separately. Inert when not hosting an
// online match (G.controlled2 just stays undefined, same as always).
function autoAssignControl() {
  if (G.ball.owner && G.ball.owner.__team === 0) {
    G.controlled = G.ball.owner;
  } else if (!G.controlled || G.controlled.__team !== 0) {
    const mine = outfield(G.teams[0]);
    mine.sort((a, b) => dist(a.pos, G.ball.pos) - dist(b.pos, G.ball.pos));
    G.controlled = mine[0];
  }
  if (!(G.online && G.online.role === 'host')) return;
  if (G.ball.owner && G.ball.owner.__team === 1) {
    G.controlled2 = G.ball.owner;
  } else if (!G.controlled2 || G.controlled2.__team !== 1) {
    const mine2 = outfield(G.teams[1]);
    mine2.sort((a, b) => dist(a.pos, G.ball.pos) - dist(b.pos, G.ball.pos));
    G.controlled2 = mine2[0];
  }
}

// tag each player with which team index they belong to, for quick lookup
function tagTeams() {
  G.teams[0].players.forEach(p => p.__team = 0);
  G.teams[1].players.forEach(p => p.__team = 1);
  G.teams[0].bench.forEach(p => p.__team = 0);
  G.teams[1].bench.forEach(p => p.__team = 1);
}

// ============================================================
// Match setup
// ============================================================
let lastMatchSettings = null;

// ---------- Season mode ----------
// A personal campaign against every other team once - not a full simulated
// league (the other teams don't play each other), just your own record and
// results across all the fixtures.
let SEASON = null; // { yourIdx, skillKey, halfLenMin, opponentOrder, fixtureIdx, record, results }

function startSeason(yourIdx, halfLenMin, skillKey) {
  const opponentOrder = TEAMS.map((_, i) => i).filter(i => i !== yourIdx);
  SEASON = {
    yourIdx, halfLenMin, skillKey, opponentOrder, fixtureIdx: 0,
    record: { played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0 },
    results: [],
  };
  startSeasonMatch();
}

function startSeasonMatch() {
  const oppIdx = SEASON.opponentOrder[SEASON.fixtureIdx];
  initMatch(SEASON.yourIdx, oppIdx, SEASON.halfLenMin, SEASON.skillKey);
  showScreen('match-screen');
}

function recordSeasonResult() {
  const gf = G.teams[0].score, ga = G.teams[1].score;
  const r = SEASON.record;
  r.played++; r.gf += gf; r.ga += ga;
  if (gf > ga) { r.won++; r.points += 3; }
  else if (gf === ga) { r.drawn++; r.points += 1; }
  else { r.lost++; }
  SEASON.results.push({ oppIdx: SEASON.opponentOrder[SEASON.fixtureIdx], gf, ga });
  SEASON.fixtureIdx++;
}

function renderSeasonTable() {
  const r = SEASON.record;
  const stat = (label, value) => `<div class="season-stat-chip"><span class="stat-value">${value}</span><span class="stat-label">${label}</span></div>`;
  document.getElementById('season-record').innerHTML = `<div class="season-stat-row">` +
    stat('Played', r.played) + stat('Won', r.won) + stat('Drawn', r.drawn) + stat('Lost', r.lost) +
    stat('Goals', `${r.gf}-${r.ga}`) + stat('Points', r.points) +
    `</div>`;

  const rows = SEASON.opponentOrder.map((oppIdx, i) => {
    const oppName = TEAMS[oppIdx].name;
    if (i < SEASON.results.length) {
      const res = SEASON.results[i];
      const badgeCls = res.gf > res.ga ? 'badge-win' : res.gf === res.ga ? 'badge-draw' : 'badge-loss';
      const letter = res.gf > res.ga ? 'W' : res.gf === res.ga ? 'D' : 'L';
      return `<tr><td>vs ${oppName}</td><td>${res.gf}-${res.ga} <span class="fixture-badge ${badgeCls}">${letter}</span></td></tr>`;
    }
    return `<tr class="fixture-upcoming"><td>vs ${oppName}</td><td>upcoming</td></tr>`;
  });
  document.getElementById('season-fixtures').innerHTML = `<table>${rows.join('')}</table>`;

  const seasonDone = SEASON.fixtureIdx >= SEASON.opponentOrder.length;
  document.getElementById('btn-season-next').classList.toggle('hidden', seasonDone);
}

// ---------- Cup mode ----------
// Single-elimination knockout: your team plus 4 randomly-drawn opponents
// (sorted weakest-to-strongest, so the Final tends to be the toughest game),
// one per round. A draw after full time goes to a penalty shootout - no
// replays, no away goals, straight knockout.
const CUP_ROUND_NAMES = ['Round of 16', 'Quarter-Final', 'Semi-Final', 'Final'];
let CUP = null; // { yourIdx, halfLenMin, skillKey, opponents:[idx,idx,idx,idx], round, history:[], eliminatedAt, won }

function startCup(yourIdx, halfLenMin, skillKey) {
  const pool = TEAMS.map((_, i) => i).filter(i => i !== yourIdx);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const opponents = pool.slice(0, CUP_ROUND_NAMES.length).sort((a, b) => (TEAMS[a].strength || 1) - (TEAMS[b].strength || 1));
  CUP = { yourIdx, halfLenMin, skillKey, opponents, round: 0, history: [], eliminatedAt: null, won: false };
  startCupMatch();
}

function startCupMatch() {
  const oppIdx = CUP.opponents[CUP.round];
  initMatch(CUP.yourIdx, oppIdx, CUP.halfLenMin, CUP.skillKey);
  showScreen('match-screen');
}

function recordCupResult(shootoutResult) {
  const ourScore = G.teams[0].score, theirScore = G.teams[1].score;
  const wonMatch = shootoutResult ? shootoutResult.homePens > shootoutResult.awayPens : ourScore > theirScore;
  CUP.history.push({
    round: CUP.round, oppIdx: CUP.opponents[CUP.round], ourScore, theirScore,
    pens: shootoutResult ? { home: shootoutResult.homePens, away: shootoutResult.awayPens } : null,
    won: wonMatch,
  });
  if (wonMatch) {
    if (CUP.round === CUP_ROUND_NAMES.length - 1) {
      CUP.won = true;
      const lt = loadLifetime();
      lt.cupsWon++;
      saveLifetime(lt);
    } else {
      CUP.round++;
    }
  } else {
    CUP.eliminatedAt = CUP.round;
  }
}

function renderCupProgress() {
  const statusEl = document.getElementById('cup-status');
  if (CUP.won) {
    statusEl.innerHTML = '<div class="season-stat-row"><div class="season-stat-chip"><span class="stat-value">&#127942;</span><span class="stat-label">Champions</span></div></div>';
  } else if (CUP.eliminatedAt != null) {
    statusEl.innerHTML = `<div class="season-stat-row"><div class="season-stat-chip"><span class="stat-value">Out</span><span class="stat-label">${CUP_ROUND_NAMES[CUP.eliminatedAt]}</span></div></div>`;
  } else {
    statusEl.innerHTML = `<div class="season-stat-row"><div class="season-stat-chip"><span class="stat-value">${CUP_ROUND_NAMES[CUP.round]}</span><span class="stat-label">vs ${TEAMS[CUP.opponents[CUP.round]].name}</span></div></div>`;
  }
  const rows = CUP.history.map(h => {
    const oppName = TEAMS[h.oppIdx].name;
    const badgeCls = h.won ? 'badge-win' : 'badge-loss';
    const letter = h.won ? 'W' : 'L';
    const scoreText = h.pens ? `${h.ourScore}-${h.theirScore} (pens ${h.pens.home}-${h.pens.away})` : `${h.ourScore}-${h.theirScore}`;
    return `<tr><td>${CUP_ROUND_NAMES[h.round]}</td><td>vs ${oppName}</td><td>${scoreText} <span class="fixture-badge ${badgeCls}">${letter}</span></td></tr>`;
  });
  document.getElementById('cup-rounds').innerHTML = `<table>${rows.join('')}</table>`;
  const stillIn = !CUP.won && CUP.eliminatedAt == null;
  document.getElementById('btn-cup-next').classList.toggle('hidden', !stillIn);
}

// ---------- Career mode ----------
// Adds persistent, ageing, named players on top of the disposable per-match
// squads every other mode already uses (see buildTeam/makeSquadPlayer, which
// still re-roll a fresh 16 every single match for everyone else). Only the
// human's own club gets this treatment - opponents stay exactly as they are
// today (disposable players, static TEAMS[i].strength).
const CAREER_SLOTS = 6;
const CAREER_REGEN_FIRST = ['Kai', 'Leo', 'Marcus', 'Theo', 'Jayden', 'Rio', 'Idris', 'Callum', 'Tyrell', 'Noah', 'Elias', 'Mason', 'Aaron', 'Dexter', 'Reuben', 'Zaid'];
const CAREER_REGEN_LAST = ['Osei', 'Whitfield', 'Carvalho', 'Nakamura', 'Bergström', 'Kowalski', 'Okafor', 'Delacroix', 'Marchetti', 'Sørensen', 'Novak', 'Adeyemi', 'Larsson', 'Petit', 'Ibáñez', 'Voss'];
let CAREER = null; // { slot, clubIdx, seasonNumber, budget, squad, freeAgents, opponentOrder, fixtureIdx, record, results, nextGenerationSeason }
let careerNextPlayerId = 1;

function generateRegenName() {
  const first = CAREER_REGEN_FIRST[Math.floor(Math.random() * CAREER_REGEN_FIRST.length)];
  const last = CAREER_REGEN_LAST[Math.floor(Math.random() * CAREER_REGEN_LAST.length)];
  return `${first} ${last}`;
}

// The rest of the football world isn't frozen forever - every club's
// strength drifts a little and its squad gradually refreshes each season
// (see evolveWorldClub). This has to be a per-save overlay, never a direct
// mutation of ALL_CLUBS[i] itself: ALL_CLUBS is one shared array (TEAMS'
// entries are literally the same objects Play/Season/Cup/Practice read), so
// mutating it directly would leak one save's 20-season history into every
// other save AND into non-Career modes. CAREER.worldState[clubIdx] holds
// only the clubs actually touched so far; everything else falls back to the
// original ALL_CLUBS[i] data untouched.
function effectiveClub(clubIdx) {
  const base = ALL_CLUBS[clubIdx];
  const w = CAREER.worldState && CAREER.worldState[clubIdx];
  if (!w) return base;
  return { ...base, strength: clamp((base.strength || 1) + w.strengthDelta, 0.55, 1.4), squad: w.squad };
}

// Lazily creates (and always returns) a club's worldState entry, cloning its
// squad from the base ALL_CLUBS data on first touch - critically, a clone,
// not a reference, since evolveWorldClub mutates this array in place and it
// must never be the same array ALL_CLUBS[i].squad[group] itself points to.
function ensureWorldState(clubIdx) {
  CAREER.worldState = CAREER.worldState || {};
  if (!CAREER.worldState[clubIdx]) {
    const base = ALL_CLUBS[clubIdx];
    CAREER.worldState[clubIdx] = {
      strengthDelta: 0,
      squad: { GK: base.squad.GK.slice(), DEF: base.squad.DEF.slice(), MID: base.squad.MID.slice(), FWD: base.squad.FWD.slice() },
      generated: {},
      // Names currently in `squad` that should roll as a young, unproven
      // prospect (lower age/value, no star-listing premium) the first time
      // they're generated in getTransferPool - rather than every squad slot
      // rolling as if it were still the departed star who used to be there.
      // A plain array, not a Set - CAREER gets JSON-serialised for
      // localStorage and a Set would silently come back empty on reload.
      youngNames: [],
    };
  }
  return CAREER.worldState[clubIdx];
}

// Fires once per ALL_CLUBS entry, once per season (see endCareerSeason) -
// nudges strength a little further along its own random walk (delta itself
// capped well inside effectiveClub's own hard floor/ceiling) and has a
// roughly 50% chance to swap one name in one position group for a freshly-
// generated one, reusing generateRegenName() rather than a second name
// generator.
function evolveWorldClub(clubIdx) {
  const w = ensureWorldState(clubIdx);
  w.strengthDelta = clamp(w.strengthDelta + rand(-0.02, 0.02), -0.35, 0.35);
  if (Math.random() < 0.5) {
    const groups = ['GK', 'DEF', 'MID', 'FWD'];
    const group = groups[Math.floor(Math.random() * groups.length)];
    const list = w.squad[group];
    if (list.length) {
      const i = Math.floor(Math.random() * list.length);
      delete w.generated[list[i]];
      const freshName = generateRegenName();
      list[i] = freshName;
      w.youngNames = w.youngNames || [];
      w.youngNames.push(freshName);
    }
  }
}

// Rescales every club's real TEAMS[i].strength onto a wide £50m-£300m
// starting-budget range (computed off whatever the actual weakest/strongest
// club in TEAMS currently is, rather than hardcoded numbers, so this keeps
// working if TEAMS' strengths are ever retuned) - a real Man City vs Burnley
// gap instead of the much flatter spread a simple linear formula gave before.
// Floor kept at £50m rather than lower so even the weakest club can actually
// afford to sign someone.
function computeClubBudget(def) {
  // Scaled against def's OWN league's strength range, not always TEAMS -
  // otherwise a mid-table Championship/lower-league club's strength (which
  // is calibrated relative to ITS OWN division, not the Premier League's
  // much higher band) gets read against the wrong scale and comes out with
  // a Premier-League-sized budget it has no business having.
  const leagueClubs = ALL_CLUBS.filter(c => c.league === def.league);
  const strengths = leagueClubs.map(c => c.strength || 1);
  const minS = Math.min(...strengths), maxS = Math.max(...strengths);
  const t = maxS > minS ? ((def.strength || 1) - minS) / (maxS - minS) : 0.5;
  return Math.round(50 + t * 250);
}

// attrLevel is roughly the same 0.6-1.5 range makeSquadPlayer already rolls
// (teamFactor-scaled for an established pro, a flat mid-range roll for a
// freshly-generated youth prospect - see generateRegenBatch).
function computePlayerValue(cp) {
  const avg = (cp.pace + cp.tackling + cp.finishing + cp.reflexes) / 4;
  const ageFactor = cp.age < 21 ? 0.8 : cp.age <= 29 ? 1.2 : cp.age <= 33 ? 0.9 : 0.5;
  return Math.max(1, Math.round(avg * 30 * ageFactor) + 40); // flat +£40m across the board, on top of the skill/age-based figure
}

// Two things a player generated in the past can go stale on, both fixed
// here: REAL_PLAYER_AGE only gets read the moment a player is first
// generated (makeCareerPlayer) - anyone already generated before that table
// existed, or before a name was added to it, is stuck showing whatever
// random age it originally rolled forever otherwise. And .value is only
// ever computed once at generation time too, so a later change to
// computePlayerValue's own formula (e.g. an across-the-board price
// adjustment) would otherwise only affect players generated AFTER that
// change, not anyone already cached. Called every time the dashboard loads
// (a cheap pass - squad + free agents + every club's own cached transfer
// listings) so an existing save self-heals on both counts instead of
// needing a fresh save to ever see a correction.
function reapplyRealAges(data) {
  if (!data) return;
  const fix = cp => {
    if (!cp || !cp.name) return;
    const realAge = REAL_PLAYER_AGE[cp.name];
    if (realAge != null && cp.age !== realAge) {
      cp.age = realAge;
      const avg = (cp.pace + cp.tackling + cp.finishing + cp.reflexes) / 4;
      cp.potential = realAge < 24 ? clamp(avg + rand(0.05, 0.3), avg, 1.5) : avg;
    }
    cp.value = computePlayerValue(cp); // always refreshed, not just on an age correction - see comment above
  };
  (data.squad || []).forEach(fix);
  (data.freeAgents || []).forEach(fix);
  Object.values(data.worldState || {}).forEach(w => {
    Object.values(w.generated || {}).forEach(fix);
  });
}

// A realistic-ish age for an established pro - weighted toward the mid-20s
// (a real squad has far more 23-28 year-olds than players right at either
// edge of the range) rather than every age in a flat range being equally
// likely. Averaging two independent uniform rolls is a cheap approximation
// of a bell curve without needing a real Gaussian sampler.
function randPlayerAge(min, max) {
  const t = (Math.random() + Math.random()) / 2;
  return Math.round(min + t * (max - min));
}

// Real-world ages for the recognisable real players this game deliberately
// used (current club starting XIs, the biggest global names elsewhere) -
// training-knowledge based, so treat as "roughly right as of when this was
// written" rather than exact. Deliberately NOT exhaustive: the vast
// majority of squad-depth names across 100+ clubs are either real players
// too obscure to date confidently, or names invented outright to fill out
// bench depth at that scale - neither has a real age to look up, so both
// fall back to randPlayerAge instead (see resolvePlayerAge).
const REAL_PLAYER_AGE = {
  // Arsenal
  'David Raya': 30, 'William Saliba': 24, 'Gabriel Magalhães': 28, 'Declan Rice': 27, 'Martin Ødegaard': 27,
  'Bukayo Saka': 24, 'Gabriel Martinelli': 24, 'Kai Havertz': 26,
  // Aston Villa
  'Emiliano Martínez': 33, 'Ezri Konsa': 28, 'John McGinn': 30, 'Ollie Watkins': 29,
  // Bournemouth
  'Illia Zabarnyi': 23, 'Antoine Semenyo': 25, 'Evanilson': 26,
  // Brentford
  'Mark Flekken': 32, 'Nathan Collins': 24, 'Kevin Schade': 23, 'Yoane Wissa': 28,
  // Brighton
  'Bart Verbruggen': 23, 'Lewis Dunk': 34, 'Kaoru Mitoma': 28, 'Danny Welbeck': 35,
  // Burnley
  'James Trafford': 23, 'Josh Cullen': 29, 'Josh Brownhill': 30,
  // Chelsea
  'Robert Sánchez': 28, 'Levi Colwill': 22, 'Reece James': 26, 'Marc Cucurella': 27, 'Enzo Fernández': 25,
  'Moisés Caicedo': 24, 'Cole Palmer': 23, 'Nicolas Jackson': 24, 'João Pedro': 24,
  // Crystal Palace
  'Dean Henderson': 28, 'Marc Guéhi': 25, 'Jean-Philippe Mateta': 28, 'Ismaïla Sarr': 27,
  // Everton
  'Jordan Pickford': 32, 'Jarrad Branthwaite': 23, 'James Tarkowski': 33, 'Idrissa Gueye': 36,
  // Fulham
  'Bernd Leno': 34, 'Joachim Andersen': 29, 'Antonee Robinson': 28, 'Sander Berge': 27, 'Raúl Jiménez': 34,
  // Leeds
  'Illan Meslier': 25, 'Pascal Struijk': 26, 'Brenden Aaronson': 25, 'Patrick Bamford': 32,
  // Liverpool
  'Alisson Becker': 33, 'Virgil van Dijk': 34, 'Ibrahima Konaté': 26, 'Andrew Robertson': 31, 'Alexis Mac Allister': 26,
  'Mohamed Salah': 33, 'Darwin Núñez': 26, 'Cody Gakpo': 26, 'Florian Wirtz': 22,
  // Man City
  'Rúben Dias': 28, 'Joško Gvardiol': 23, 'Nathan Aké': 30, 'Rodri': 29, 'Mateo Kovačić': 31, 'Bernardo Silva': 31,
  'Erling Haaland': 25, 'Phil Foden': 25, 'Jérémy Doku': 23,
  // Man United
  'André Onana': 29, 'Lisandro Martínez': 27, 'Matthijs de Ligt': 26, 'Bruno Fernandes': 31, 'Casemiro': 33,
  'Kobbie Mainoo': 20, 'Rasmus Højlund': 23,
  // Newcastle
  'Nick Pope': 33, 'Sven Botman': 25, 'Kieran Trippier': 35, 'Bruno Guimarães': 27, 'Sandro Tonali': 25, 'Alexander Isak': 26,
  // Nottingham Forest
  'Matz Sels': 33, 'Murillo': 23, 'Nikola Milenković': 27, 'Chris Wood': 33,
  // Sunderland
  'Anthony Patterson': 25, 'Dan Ballard': 26, 'Trai Hume': 23,
  // Tottenham
  'Guglielmo Vicario': 28, 'Cristian Romero': 27, 'Micky van de Ven': 24, 'Pedro Porro': 26, 'James Maddison': 28, 'Son Heung-min': 33,
  // West Ham
  'Alphonse Areola': 32, 'Max Kilman': 28, 'Aaron Wan-Bissaka': 27, 'Tomáš Souček': 30, 'James Ward-Prowse': 30, 'Jarrod Bowen': 28,
  // Wolves
  'José Sá': 32, 'João Gomes': 24, 'Hwang Hee-chan': 29,
  // Real Madrid
  'Thibaut Courtois': 33, 'Dani Carvajal': 33, 'Antonio Rüdiger': 32, 'Éder Militão': 27, 'David Alaba': 33,
  'Jude Bellingham': 22, 'Eduardo Camavinga': 22, 'Aurélien Tchouaméni': 25, 'Federico Valverde': 27,
  'Kylian Mbappé': 27, 'Vinícius Júnior': 25, 'Rodrygo': 24,
  // Barcelona
  'Marc-André ter Stegen': 33, 'Jules Koundé': 26, 'Pau Cubarsí': 18, 'Ronald Araújo': 26, 'Alejandro Balde': 21,
  'Pedri': 22, 'Gavi': 21, 'Frenkie de Jong': 28, 'Robert Lewandowski': 37, 'Raphinha': 28, 'Lamine Yamal': 18,
  // Atlético Madrid
  'Jan Oblak': 32, 'José Giménez': 30, 'Koke': 33, 'Rodrigo De Paul': 31, 'Julián Álvarez': 25, 'Antoine Griezmann': 34,
  // Bayern Munich
  'Manuel Neuer': 39, 'Dayot Upamecano': 26, 'Min-jae Kim': 29, 'Alphonso Davies': 25, 'Joshua Kimmich': 30,
  'Jamal Musiala': 22, 'Harry Kane': 32,
  // Borussia Dortmund
  'Gregor Kobel': 27, 'Nico Schlotterbeck': 25, 'Serhou Guirassy': 29,
  // PSG
  'Marquinhos': 31, 'Achraf Hakimi': 26, 'Vitinha': 25, 'Fabián Ruiz': 29, 'Ousmane Dembélé': 28, 'Bradley Barcola': 22,
  // Juventus
  'Dušan Vlahović': 25, 'Manuel Locatelli': 27,
  // Inter Milan
  'Yann Sommer': 36, 'Alessandro Bastoni': 26, 'Nicolò Barella': 28, 'Lautaro Martínez': 27, 'Marcus Thuram': 27,
  // AC Milan
  'Mike Maignan': 30, 'Theo Hernández': 27, 'Rafael Leão': 26,
  // Napoli
  'Alex Meret': 28, 'Giovanni Di Lorenzo': 32, 'Romelu Lukaku': 32, 'Scott McTominay': 29,
  // --- EFL Championship ---
  // Leicester City
  'Danny Ward': 32, 'Wout Faes': 27, 'Jannik Vestergaard': 33, 'Ricardo Pereira': 32, 'James Justin': 27,
  'Victor Kristiansen': 23, 'Wilfred Ndidi': 29, 'Oliver Skipp': 25, 'Patson Daka': 27, 'Stephy Mavididi': 27, 'Abdul Fatawu': 21,
  // Southampton
  'Alex McCarthy': 36, 'Jan Bednarek': 30, 'Jack Stephens': 31, 'Adam Armstrong': 29, 'Ryan Fraser': 32, 'Flynn Downes': 26,
  // Ipswich Town
  'Vaclav Hladky': 33, 'Sam Morsy': 34, 'Omari Hutchinson': 22, 'Leif Davis': 26, 'Kalvin Phillips': 30,
  // West Bromwich Albion
  'Alex Palmer': 29, 'Semi Ajayi': 32, 'Kyle Bartley': 34, 'John Swift': 30, 'Josh Maja': 27, 'Jed Wallace': 32,
  // Norwich City
  'Angus Gunn': 30, 'Grant Hanley': 34, 'Shane Duffy': 34, 'Borja Sainz': 25, 'Adam Idah': 25, 'Marcelino Núñez': 26,
  // Middlesbrough
  'Dael Fry': 28, 'Emmanuel Latte Lath': 26, 'Hayden Hackney': 24,
  // Sheffield Wednesday
  'Barry Bannan': 36, 'James Beadle': 21, 'Michael Smith': 34, 'Josh Windass': 32,
  // Watford
  'Jonathan Bond': 34, 'Daniel Bachmann': 31, 'Ken Sema': 32, 'Giorgi Chakvetadze': 25, 'Vakoun Bayo': 29,
  // Sheffield United
  'Anel Ahmedhodžić': 26, 'Gustavo Hamer': 28, 'Kieffer Moore': 33, 'Rhian Brewster': 26,
  // Coventry City
  'Ben Sheaf': 27, 'Ellis Simms': 24, 'Haji Wright': 27, 'Jake Bidwell': 33,
  // Bristol City
  'Zak Vyner': 28, 'Nahki Wells': 35, 'Ross Stewart': 29, 'Tommy Conway': 23,
  // Preston North End
  'Freddie Woodman': 29, 'Emil Riis': 27, 'Will Keane': 33, 'Robbie Brady': 34,
  // Swansea City
  'Ben Cabango': 26, 'Josh Key': 22, 'Liam Cullen': 24,
  // Hull City
  'Jacob Greaves': 24, 'Ozan Tufan': 31,
  // Millwall
  'George Saville': 32, 'Zian Flemming': 27, 'Duncan Watmore': 31,
  // Blackburn Rovers
  'Sondre Tronstad': 30, 'Todd Cantwell': 27, 'Andreas Weimann': 34, 'Sammie Szmodics': 30,
  // Stoke City
  'Viktor Johansson': 26, 'Ben Wilmot': 25, 'Lewis Baker': 30,
  // Portsmouth
  'Colby Bishop': 28, 'Marlon Pack': 34,
  // Oxford United
  'Cameron Brannagan': 28, 'Elliott Moore': 28,
  // Derby County
  'Curtis Nelson': 33, 'Kane Wilson': 25, 'Martyn Waghorn': 36, 'Jerry Yates': 28,
  // Queens Park Rangers
  'Ilias Chair': 28, 'Jack Colback': 35, 'Charlie Austin': 37, 'Asmir Begović': 38, 'Sam Field': 27,
  // Charlton Athletic
  'Alfie May': 32, 'Greg Docherty': 29, 'Miles Leaburn': 21, 'Tom Lockyer': 31,
  // Wrexham
  'Paul Mullin': 30, 'James McClean': 36, 'Sam Vokes': 36, 'Steven Fletcher': 39,
  // Birmingham City
  'John Ruddy': 39, 'Krystian Bielik': 27, 'Jay Stansfield': 23, 'Tommy Doyle': 24,
  // --- La Liga ---
  // Athletic Bilbao
  'Unai Simón': 28, 'Yeray Álvarez': 32, 'Dani Vivian': 26, 'Nico Williams': 23, 'Iñaki Williams': 31,
  'Óscar de Marcos': 35, 'Oihan Sancet': 24,
  // Real Sociedad
  'Álex Remiro': 30, 'Mikel Oyarzabal': 28, 'Take Kubo': 24, 'Igor Zubeldia': 28,
  // Real Betis
  'Héctor Bellerín': 30, 'Marc Bartra': 34, 'Isco': 33, 'Nabil Fekir': 32, 'Rui Silva': 32, 'Antony': 25,
  // Sevilla
  'Saúl Ñíguez': 31, 'Marcao': 29, 'Nemanja Gudelj': 34,
  // Villarreal
  'Dani Parejo': 36, 'Gerard Moreno': 33,
  // Valencia
  'José Gayà': 30, 'Hugo Duro': 26,
  // Celta Vigo
  'Marcos Alonso': 34, 'Vicente Guaita': 39, 'Borja Iglesias': 32,
  // Osasuna
  'Ante Budimir': 34, 'David García': 34,
  // Girona
  'Cristhian Stuani': 39, 'Aleix García': 28,
  // Getafe
  'David Soria': 33, 'Luca Zidane': 27, 'Borja Mayoral': 28,
  // Mallorca
  'Vedat Muriqi': 30, 'Antonio Raíllo': 33,
  // Alavés
  'Ianis Hagi': 27,
  // Espanyol
  'Joan García': 25,
  // --- Ligue 1 ---
  // Paris Saint-Germain
  'Nuno Mendes': 23, 'João Neves': 20,
  // Marseille
  'Mason Greenwood': 24,
  // Monaco
  'Denis Zakaria': 28, 'Aleksandr Golovin': 29, 'Folarin Balogun': 24, 'Takumi Minamino': 30,
  // Lyon
  'Corentin Tolisso': 31, 'Alexandre Lacazette': 34, 'Nemanja Matić': 37,
  // Lille
  'Jonathan David': 25, 'Benjamin André': 34,
  // Nice
  'Dante': 42, 'Jean-Clair Todibo': 26, 'Terem Moffi': 26,
  // Lens
  'Brice Samba': 31, 'Kevin Danso': 27,
  // Rennes
  'Steve Mandanda': 41,
  // Strasbourg
  'Habib Diarra': 21, 'Andrey Santos': 21,
  // Nantes
  'Alban Lafont': 27, 'Moses Simon': 30,
  // --- Bundesliga ---
  // Bayern Munich
  'Manuel Neuer': 39, 'Dayot Upamecano': 26, 'Alphonso Davies': 25, 'Joshua Kimmich': 30, 'Jamal Musiala': 22,
  'Harry Kane': 32, 'Serge Gnabry': 30, 'Kingsley Coman': 29, 'Michael Olise': 23,
  // Bayer Leverkusen
  'Jonathan Tah': 29, 'Robert Andrich': 30, 'Patrik Schick': 29,
  // Borussia Dortmund
  'Gregor Kobel': 27, 'Nico Schlotterbeck': 25, 'Marcel Sabitzer': 31, 'Serhou Guirassy': 29, 'Karim Adeyemi': 24,
  // RB Leipzig
  'Willi Orbán': 32, 'Xaver Schlager': 27, 'Loïs Openda': 25,
  // Eintracht Frankfurt
  'Kevin Trapp': 35,
  // VfB Stuttgart
  'Deniz Undav': 28,
  // SC Freiburg
  'Vincenzo Grifo': 32, 'Ritsu Doan': 27,
  // Mainz 05
  'Robin Zentner': 30, 'Nadiem Amiri': 28,
  // Borussia Mönchengladbach
  'Rocco Reitz': 23,
  // VfL Wolfsburg
  'Maximilian Arnold': 31,
  // Union Berlin
  'Frederik Rønnow': 32,
  // Werder Bremen
  'Marvin Ducksch': 31,
  // TSG Hoffenheim
  'Oliver Baumann': 35, 'Andrej Kramarić': 34,
  // --- Serie A (remaining clubs) ---
  // Bologna
  'Lukasz Skorupski': 34, 'Remo Freuler': 33, 'Riccardo Orsolini': 28, 'Ciro Immobile': 36,
  // Torino
  'Guillermo Maripán': 32, 'Duván Zapata': 34, 'Che Adams': 29,
  // Udinese
  'Florian Thauvin': 32,
  // Genoa
  'Ruslan Malinovskyi': 32, 'Junior Messias': 34,
  // Cagliari
  'Yerry Mina': 30, 'Gianluca Lapadula': 35,
  // Como
  'Pepe Reina': 43, 'Nico Paz': 21,
  // Parma
  'Woyo Coulibaly': 20, 'Dennis Man': 27,
  // Lecce
  'Nikola Krstović': 25, 'Ante Rebić': 32,
  // Sassuolo
  'Domenico Berardi': 31,
};

// Real age when we actually know it, otherwise the same randomised-but-
// realistic curve everyone else gets - see randPlayerAge/REAL_PLAYER_AGE's
// own comment on why most names can't have a real age looked up at all.
function resolvePlayerAge(name, min, max) {
  return REAL_PLAYER_AGE[name] != null ? REAL_PLAYER_AGE[name] : randPlayerAge(min, max);
}

// Every club's squad data lists players star-first, fringe/bench-depth-last
// (see TEAMS/CHAMPIONSHIP_TEAMS/etc.). There's no real transfer-market-value
// data to draw on for thousands of individual names, so that listing order
// is used as a rough stand-in for real-world renown - a club's headline
// names get a genuine value premium over their own bench, rather than every
// squad player being rated purely off a flat club-wide strength average.
function renownFactor(index, groupLength) {
  if (groupLength <= 1) return 1.15;
  const t = index / (groupLength - 1); // 0 = star name, 1 = fringe/bench name
  return 1.3 - t * 0.55; // roughly 1.3 down to 0.75
}

function makeCareerPlayer(name, group, teamFactor, age) {
  const cp = {
    id: careerNextPlayerId++,
    name, group, age,
    pace: clamp(rand(0.85, 1.15) * teamFactor, 0.6, 1.5),
    tackling: clamp(rand(0.85, 1.15) * teamFactor, 0.6, 1.5),
    finishing: clamp(rand(0.85, 1.15) * teamFactor, 0.6, 1.5),
    reflexes: clamp(rand(0.85, 1.15) * teamFactor, 0.6, 1.5),
  };
  const avg = (cp.pace + cp.tackling + cp.finishing + cp.reflexes) / 4;
  cp.potential = age < 24 ? clamp(avg + rand(0.05, 0.3), avg, 1.5) : avg;
  cp.value = computePlayerValue(cp);
  return cp;
}

// The initial squad for a new career - reuses the club's existing TEAMS[i].squad
// name lists (same ones assignRealNames draws on for a one-off match) so a new
// save starts with the club's real, recognisable lineup.
function generateInitialCareerSquad(def) {
  const teamFactor = def.strength || 1;
  const squad = [];
  if (!def.squad) return squad;
  Object.keys(def.squad).forEach(group => {
    const names = def.squad[group];
    names.forEach((name, i) => {
      squad.push(makeCareerPlayer(name, group, teamFactor * renownFactor(i, names.length), resolvePlayerAge(name, 18, 34)));
    });
  });
  return squad;
}

// 2-4 new 17-19-year-olds, fictional (not real players - this is genuinely new
// blood the career itself created, so invented names are correct here rather
// than reusing real ones). Land in the free-agent pool, same as anyone else
// signable through the transfer market - no separate "youth academy" concept.
function generateRegenBatch() {
  const groups = ['GK', 'DEF', 'DEF', 'MID', 'MID', 'FWD', 'FWD'];
  const count = Math.floor(rand(2, 5));
  const batch = [];
  for (let i = 0; i < count; i++) {
    const group = groups[Math.floor(Math.random() * groups.length)];
    const cp = makeCareerPlayer(generateRegenName(), group, 1.0, Math.round(rand(17, 19)));
    cp.potential = clamp(cp.potential + rand(0.1, 0.25), 0, 1.5); // a bit more room to grow than a same-age established pro
    cp.value = computePlayerValue(cp);
    batch.push(cp);
  }
  return batch;
}

// Each slot is its own localStorage key (same pattern as LIFETIME_KEY/
// loadLifetime/saveLifetime) rather than folded into the shared saveSettings
// blob - a career save is far bigger than a settings patch and the 5 slots
// need to be addressable/deletable independently.
function careerSlotKey(n) { return `zacFootballCareerSlot${n}`; }
function loadCareerSlot(n) {
  try { return JSON.parse(localStorage.getItem(careerSlotKey(n))); } catch (e) { return null; }
}
function saveCareerSlot(n, data) {
  try { localStorage.setItem(careerSlotKey(n), JSON.stringify(data)); } catch (e) { /* localStorage unavailable - career progress just won't persist */ }
  // Every save is "this is the career I'm actively playing right now" - see
  // updateMenuContinueCareerCard, which reads this back to decide what the
  // main menu's Continue Career card points at.
  saveSettings({ lastCareerSlot: n });
}
// Main menu's "Continue Career" shortcut - skips Main Menu -> Career ->
// pick slot -> dashboard down to a single tap, for whichever save was most
// recently loaded/saved (see saveCareerSlot/the slots screen's Continue
// button, both of which keep settings.lastCareerSlot up to date).
function updateMenuContinueCareerCard() {
  const card = document.getElementById('btn-menu-continue-career');
  const slot = loadSettings().lastCareerSlot;
  const data = slot ? loadCareerSlot(slot) : null;
  if (!data) { card.classList.add('hidden'); return; }
  const def = ALL_CLUBS[data.clubIdx];
  document.getElementById('menu-continue-club').textContent = def ? def.name : '?';
  document.getElementById('menu-continue-detail').textContent = `Season ${data.seasonNumber} — £${data.budget}m`;
  card.classList.remove('hidden');
  card.onclick = () => {
    CAREER = data;
    restoreCareerNextPlayerId(data);
    showCareerDashboard();
  };
}

// careerNextPlayerId is a plain module-level counter, not itself saved as
// part of CAREER - after a page reload it resets to 1, so the next freshly
// generated player (a transfer-market listing, a regen) could get an id
// that collides with one already used by someone in the loaded save. That
// corrupts getCareerLineup's used-Set "already picked" tracking (which
// assumes ids are unique), showing the wrong player in a squad slot even
// though the right one was actually signed. Bump the counter past the
// highest id already in use every time a save is loaded.
function restoreCareerNextPlayerId(data) {
  let maxId = 0;
  (data.squad || []).forEach(cp => { if (cp.id > maxId) maxId = cp.id; });
  (data.freeAgents || []).forEach(cp => { if (cp.id > maxId) maxId = cp.id; });
  Object.values(data.worldState || {}).forEach(w => {
    Object.values(w.generated || {}).forEach(cp => { if (cp.id > maxId) maxId = cp.id; });
  });
  if (maxId >= careerNextPlayerId) careerNextPlayerId = maxId + 1;
}
function deleteCareerSlot(n) {
  try { localStorage.removeItem(careerSlotKey(n)); } catch (e) { /* localStorage unavailable */ }
}
function listCareerSlots() {
  const slots = [];
  for (let n = 1; n <= CAREER_SLOTS; n++) slots.push({ slot: n, data: loadCareerSlot(n) });
  return slots;
}

// ---------- Career mode: formations ----------
// Alternatives to the live engine's own default FORMATION (still used as-is
// by every other mode). Selecting one only ever affects the human's own
// career squad (see applyCareerSquad) - opponents always play the engine's
// default shape, same as today. Each is 11 {group,x,y} slots in the exact
// shape FORMATION already uses, so the rest of the engine (computeHomePositions,
// attackTarget/defendTarget) needs no changes to understand them.
const CAREER_FORMATIONS = {
  '4-3-3': FORMATION,
  '4-4-2': [
    { group: 'GK', x: 0.04, y: 0.50 },
    { group: 'DEF', x: 0.16, y: 0.15 }, { group: 'DEF', x: 0.16, y: 0.38 }, { group: 'DEF', x: 0.16, y: 0.62 }, { group: 'DEF', x: 0.16, y: 0.85 },
    { group: 'MID', x: 0.42, y: 0.15 }, { group: 'MID', x: 0.42, y: 0.38 }, { group: 'MID', x: 0.42, y: 0.62 }, { group: 'MID', x: 0.42, y: 0.85 },
    { group: 'FWD', x: 0.68, y: 0.35 }, { group: 'FWD', x: 0.68, y: 0.65 },
  ],
  '4-2-3-1': [
    { group: 'GK', x: 0.04, y: 0.50 },
    { group: 'DEF', x: 0.16, y: 0.15 }, { group: 'DEF', x: 0.16, y: 0.38 }, { group: 'DEF', x: 0.16, y: 0.62 }, { group: 'DEF', x: 0.16, y: 0.85 },
    { group: 'MID', x: 0.34, y: 0.35 }, { group: 'MID', x: 0.34, y: 0.65 },
    { group: 'MID', x: 0.52, y: 0.20 }, { group: 'MID', x: 0.54, y: 0.50 }, { group: 'MID', x: 0.52, y: 0.80 },
    { group: 'FWD', x: 0.68, y: 0.50 },
  ],
  '3-5-2': [
    { group: 'GK', x: 0.04, y: 0.50 },
    { group: 'DEF', x: 0.16, y: 0.25 }, { group: 'DEF', x: 0.16, y: 0.50 }, { group: 'DEF', x: 0.16, y: 0.75 },
    { group: 'MID', x: 0.38, y: 0.10 }, { group: 'MID', x: 0.42, y: 0.32 }, { group: 'MID', x: 0.44, y: 0.50 }, { group: 'MID', x: 0.42, y: 0.68 }, { group: 'MID', x: 0.38, y: 0.90 },
    { group: 'FWD', x: 0.68, y: 0.35 }, { group: 'FWD', x: 0.68, y: 0.65 },
  ],
  '5-3-2': [
    { group: 'GK', x: 0.04, y: 0.50 },
    { group: 'DEF', x: 0.16, y: 0.10 }, { group: 'DEF', x: 0.16, y: 0.30 }, { group: 'DEF', x: 0.16, y: 0.50 }, { group: 'DEF', x: 0.16, y: 0.70 }, { group: 'DEF', x: 0.16, y: 0.90 },
    { group: 'MID', x: 0.42, y: 0.25 }, { group: 'MID', x: 0.42, y: 0.50 }, { group: 'MID', x: 0.42, y: 0.75 },
    { group: 'FWD', x: 0.68, y: 0.35 }, { group: 'FWD', x: 0.68, y: 0.65 },
  ],
};
const CAREER_FORMATION_KEYS = Object.keys(CAREER_FORMATIONS);

// ---------- Career mode: FA Cup / League Cup ----------
// Deliberately lightweight - "just more matches" with a competition label,
// not a separate bracket UI. Rounds are pre-drawn all at once (same
// simplification the standalone Cup mode already makes) and spliced into the
// season's fixture list at roughly-even intervals. A loss (or draw - no
// replays/shootouts here) knocks the remaining rounds of that competition
// off the rest of the season's fixture list; winning every round pays out.
const FA_CUP_ROUNDS = 4;
const LEAGUE_CUP_ROUNDS = 3;
const CUP_PRIZE = 30; // £m, either cup
const LEAGUE_TITLE_PRIZE = 100; // £m - awarded for finishing top of the (estimated) table, see generateLeagueTableEstimate
const COMPETITION_LABEL = {
  facup: 'FA Cup', leaguecup: 'League Cup',
  'ucl-group': 'Champions League', 'ucl-knockout': 'Champions League',
  'uel-group': 'Europa League', 'uel-knockout': 'Europa League',
};

// The second domestic cup (League Cup) stays English-only - it only fires
// while your club is currently playing in the Premier League or
// Championship (see CAREER.clubLeague). Every league gets a primary
// domestic cup though, see DOMESTIC_CUP_NAME below.
const CUP_ELIGIBLE_LEAGUES = ['Premier League', 'EFL Championship'];

// Every league's real primary domestic cup - most countries only actually
// run one prominent one (England's second, separate League Cup is the
// exception, not the norm, so that one stays gated to CUP_ELIGIBLE_LEAGUES
// below rather than being generalised to all six). The 'facup' fixture type
// stays internal/unchanged (round-tracking, prize logic) - only the display
// name varies, stored directly on each fixture at build time (see
// buildCareerFixtures) via fixtureCompetitionLabel, since CAREER.clubLeague
// can change (promotion/relegation) after a season's cup fixtures were built.
const DOMESTIC_CUP_NAME = {
  'Premier League': 'FA Cup', 'EFL Championship': 'FA Cup',
  'La Liga': 'Copa del Rey', 'Ligue 1': 'Coupe de France',
  'Bundesliga': 'DFB-Pokal', 'Serie A': 'Coppa Italia',
};
// fixture.label (set at build time) wins when present - COMPETITION_LABEL
// alone can't express a name that depends on which league the cup fixture
// was actually built under.
function fixtureCompetitionLabel(fixture) {
  const label = (fixture && fixture.label) || COMPETITION_LABEL[fixture.type];
  // Two-legged European knockout ties (see resolveEuropeGroup) - distinguish
  // which leg this fixture is without needing a separate display field.
  if (fixture && fixture.leg) return `${label} (Leg ${fixture.leg})`;
  return label;
}

// European qualification (Champions League/Europa League) - the "big 5"
// leagues only, matching reality (the Championship never sends anyone to
// Europe). Both competitions share one group mechanic (you + 3 drawn
// opponents, single round-robin, top 2 advance) and differ in opponent
// strength tier + knockout depth - see resolveEuropeGroup/buildCareerFixtures.
const EUROPE_ELIGIBLE_LEAGUES = ['Premier League', 'La Liga', 'Ligue 1', 'Bundesliga', 'Serie A'];
const UCL_QUALIFY_BONUS = 40, UCL_ADVANCE_BONUS = 30, UCL_WIN_PRIZE = 120; // £m
const UEL_QUALIFY_BONUS = 15, UEL_ADVANCE_BONUS = 10, UEL_WIN_PRIZE = 50; // £m

// Incoming transfer offers - other clubs occasionally want to buy one of
// YOUR squad players. Generated once per season alongside every other
// season-boundary event (aging, regen, world evolution) - see
// generateIncomingOffers, called from endCareerSeason.
const OFFER_CHANCE_PER_PLAYER = 0.08;
const MAX_OFFERS_PER_SEASON = 3;
const SELL_CUT = 0.9; // you keep 90% of whatever a sale actually goes for
// Three fixed counter-offer tiers (button-driven, not free-text/slider input,
// matching every other choice in this game) - the higher you push, the
// bigger the real risk the whole deal collapses instead, not just a
// fallback to the original number.
const COUNTER_TIERS = [
  { pct: 0.15, acceptChance: 0.70 },
  { pct: 0.30, acceptChance: 0.40 },
  { pct: 0.50, acceptChance: 0.15 },
];

function careerLeagueClubIdxs(clubIdx) {
  const league = CAREER.clubLeague;
  return ALL_CLUBS.map((c, i) => i).filter(i => i !== clubIdx && ALL_CLUBS[i].league === league);
}

function buildCareerFixtures(clubIdx) {
  const otherClubs = () => careerLeagueClubIdxs(clubIdx);
  // Double round-robin - every club in your division home and away, same as
  // a real league season - built as two independently-shuffled passes
  // through the full list rather than duplicating-then-shuffling everything
  // together, so a return fixture never lands right next to the first
  // meeting (other than the one join seam between the two passes, swapped
  // away below).
  const firstLeg = shuffled(otherClubs());
  const secondLeg = shuffled(otherClubs());
  if (firstLeg[firstLeg.length - 1] === secondLeg[0]) {
    const swapAt = 1 + Math.floor(Math.random() * (secondLeg.length - 1));
    [secondLeg[0], secondLeg[swapAt]] = [secondLeg[swapAt], secondLeg[0]];
  }
  const fixtures = [...firstLeg, ...secondLeg].map(oppIdx => ({ type: 'league', oppIdx }));
  // Primary domestic cup - every league runs one, with its own real name
  // (see DOMESTIC_CUP_NAME) stored directly on the fixture.
  const cupName = DOMESTIC_CUP_NAME[CAREER.clubLeague] || 'Domestic Cup';
  const faCupOpps = shuffled(otherClubs()).slice(0, FA_CUP_ROUNDS)
    .sort((a, b) => (effectiveClub(a).strength || 1) - (effectiveClub(b).strength || 1)); // tougher as rounds progress, same idea as the standalone Cup mode
  faCupOpps.forEach((oppIdx, i) => {
    fixtures.splice(Math.min(fixtures.length, (i + 1) * 9 + i), 0, { type: 'facup', oppIdx, round: i, label: cupName });
  });
  // Second domestic cup - stays English-only, matching reality (most
  // leagues here don't run a second prominent domestic cup at all).
  if (CUP_ELIGIBLE_LEAGUES.includes(CAREER.clubLeague)) {
    const leagueCupOpps = shuffled(otherClubs()).slice(0, LEAGUE_CUP_ROUNDS);
    leagueCupOpps.forEach((oppIdx, i) => {
      fixtures.splice(Math.min(fixtures.length, (i + 1) * 11 + 3 + i), 0, { type: 'leaguecup', oppIdx, round: i });
    });
  }
  // European group stage - only the 3 group fixtures are known up front;
  // whether you get a knockout fixture at all depends on the group table,
  // which isn't decided until the 3rd group match resolves - see
  // resolveEuropeGroup, which splices knockout fixtures in dynamically.
  if (CAREER.europeCompetition) {
    const comp = CAREER.europeCompetition;
    const band = europeStrengthBand(comp === 'ucl' ? 'top' : 'bottom');
    const oppIdxs = shuffled(band).slice(0, 3);
    oppIdxs.forEach((oppIdx, i) => {
      fixtures.splice(Math.min(fixtures.length, (i + 1) * 10 + 5 + i), 0, { type: `${comp}-group`, oppIdx, round: i });
    });
    CAREER.europeGroup = { comp, oppIdxs, results: [] };
  } else {
    CAREER.europeGroup = null;
  }
  return fixtures;
}

// Every ALL_CLUBS entry that could plausibly send you a European opponent -
// the "big 5" leagues (see EUROPE_ELIGIBLE_LEAGUES) other than your own.
// Returns ALL_CLUBS indices, not club objects, for consistency with
// buildCareerFixtures/generateLeagueTableEstimate's own index-based style.
function europeEligiblePool() {
  return ALL_CLUBS.map((c, i) => i).filter(i => EUROPE_ELIGIBLE_LEAGUES.includes(ALL_CLUBS[i].league) && ALL_CLUBS[i].league !== CAREER.clubLeague);
}

// Splits the eligible pool by (effective, i.e. drift-adjusted) strength into
// a "top" and "bottom" ~60% band (the two bands overlap in the middle - this
// is just a rough prestige split, not a strict cutoff) so Champions League
// opponents skew tougher than Europa League ones without needing two
// separate opponent pools.
function europeStrengthBand(tier) {
  const pool = europeEligiblePool().sort((a, b) => (effectiveClub(b).strength || 1) - (effectiveClub(a).strength || 1));
  const cut = Math.max(3, Math.round(pool.length * 0.6));
  return tier === 'top' ? pool.slice(0, cut) : pool.slice(Math.max(0, pool.length - cut));
}

// The rest of your division's final table positions are estimated rather
// than actually simulated fixture-by-fixture (that would mean playing out
// or resolving every other club's entire double round-robin every season, a
// much bigger system) - each gets a plausible points/goal-difference tally
// scaled off their real ALL_CLUBS[i].strength relative to their league's own
// average, generated fresh once per season so it holds steady while you're
// looking at it but isn't the same every season either. 51pts/38 games is
// approximately an average real Premier League points tally (used as the
// baseline for every league here, real per-division averages vary a bit but
// not enough to matter for an estimate) - clubs above/below league-average
// strength get scaled up/down from there.
function generateLeagueTableEstimate(clubIdx) {
  const leagueClubs = ALL_CLUBS.map((c, i) => i).filter(i => ALL_CLUBS[i].league === CAREER.clubLeague);
  const strengths = leagueClubs.map(i => effectiveClub(i).strength || 1);
  const avgS = strengths.reduce((a, b) => a + b, 0) / strengths.length;
  return leagueClubs.filter(i => i !== clubIdx).map(i => {
    const def = effectiveClub(i);
    const points = clamp(Math.round(51 + ((def.strength || 1) - avgS) * 220 + rand(-6, 6)), 10, 100);
    const gd = Math.round((points - 51) * 0.6 + rand(-5, 5));
    return { clubIdx: i, points, gd };
  });
}

// halfLenMin/skillKey are picked once at creation and reused for every
// fixture from then on, same idea as SEASON.halfLenMin/SEASON.skillKey -
// keeps career screens simple (no per-fixture setup step).
function newCareer(slot, clubIdx, halfLenMin, skillKey) {
  const def = ALL_CLUBS[clubIdx];
  CAREER = {
    slot, clubIdx, clubLeague: def.league, halfLenMin, skillKey, seasonNumber: 1,
    budget: computeClubBudget(def),
    squad: generateInitialCareerSquad(def),
    freeAgents: [],
    formationKey: '4-3-3',
    fixtures: [], fixtureIdx: 0,
    record: { played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0 },
    results: [],
    tableEstimate: [],
    nextGenerationSeason: 1 + Math.floor(rand(3, 5)),
    leagueTitlesWon: 0, faCupsWon: 0, leagueCupsWon: 0, uclTitlesWon: 0, uelTitlesWon: 0,
    europeCompetition: null, europeGroup: null,
    pendingKnockoutLeg1: null, // { gf, ga } from leg 1 of the current two-legged tie - see applyCareerFixtureResult
    matchLog: [], // every fixture actually played, newest last - see pushCareerMatchLog/renderCareerMatchLog
    worldState: {},
    customLineup: {},
    incomingOffers: [],
    // What THIS season has won so far - reset at the start of every season,
    // set the moment a cup/continental final is actually won (see
    // applyCareerFixtureResult/resolveEuropeGroup) - used to build this
    // season's entry in seasonHistory once it ends, see endCareerSeason.
    seasonTrophies: { facup: false, leaguecup: false, ucl: false, uel: false },
    seasonHistory: [],
  };
  // buildCareerFixtures/generateLeagueTableEstimate read CAREER.clubLeague off
  // the global - CAREER has to already be assigned before calling them, not
  // evaluated inline as part of constructing this same object literal (that
  // would read the *old* CAREER, null on a brand new save).
  CAREER.fixtures = buildCareerFixtures(clubIdx);
  CAREER.tableEstimate = generateLeagueTableEstimate(clubIdx);
  saveCareerSlot(slot, CAREER);
}

function startCareerMatch() {
  // Diagnostic only (reported laggy on some devices, no cause found in this
  // function or anything it calls after checking - left in so real numbers
  // show up in the console next time, instead of guessing blind again) -
  // safe to remove once the cause is actually found.
  console.time('careerMatchStart');
  const fixture = CAREER.fixtures[CAREER.fixtureIdx];
  // effectiveClub, not a raw ALL_CLUBS lookup, so a club that's drifted
  // stronger/weaker over past seasons actually plays at that strength live,
  // not just in generateLeagueTableEstimate/careerSimNextFixture.
  initMatchWithClubs(effectiveClub(CAREER.clubIdx), effectiveClub(fixture.oppIdx), CAREER.halfLenMin, CAREER.skillKey);
  applyCareerSquad(G.teams[0]);
  showScreen('match-screen');
  console.timeEnd('careerMatchStart');
}

// Overlays the human's persistent career squad onto the disposable per-match
// player objects buildTeam/assignRealNames already built - same "construct
// then overlay" pattern assignRealNames itself uses for real names, just
// carrying real attributes/identity (and now formation shape) across matches
// too. Falls back to whatever was already rolled for any slot the career
// squad runs short on, so a thin squad never breaks a match.
// ctx defaults to the persistent CAREER save, but online matches pass a
// throwaway {clubIdx, squad, formationKey, customLineup} context instead
// (see buildOnlineLineupContext) - one for the host's own club, one for
// whatever the guest picked - so this same logic works for either without
// touching a real save file.
function applyCareerSquad(team, ctx) {
  ctx = ctx || CAREER;
  const { starters, reserves } = getCareerLineup(ctx);
  // Starting XI: re-slot every one of the 11 pre-built player objects to the
  // chosen formation's shape (group/isGK follow the slot, not whatever
  // buildTeam's own default FORMATION originally assigned them).
  team.players.forEach((p, i) => {
    const { slot, cp } = starters[i];
    p.slot = slot;
    p.group = slot.group;
    p.isGK = slot.group === 'GK';
    if (cp) {
      p.realName = cp.name;
      p.careerId = cp.id; // lets a goal scored this match be credited back to the persistent player - see recordCareerResult
      p.pace = cp.pace; p.tackling = cp.tackling; p.finishing = cp.finishing; p.reflexes = cp.reflexes;
    }
  });
  // Bench - not formation-locked (real benches aren't either), just the rest
  // of the squad, labelled with their own natural position.
  const pool = shuffled(reserves);
  team.bench.forEach((p, i) => {
    const cp = pool[i];
    if (!cp) return;
    p.realName = cp.name;
    p.careerId = cp.id;
    p.group = cp.group;
    p.isGK = cp.group === 'GK';
    p.pace = cp.pace; p.tackling = cp.tackling; p.finishing = cp.finishing; p.reflexes = cp.reflexes;
  });
  // The match's own kickoff already ran (inside initMatch) before this overlay
  // touched p.slot, so home positions need recomputing against the new
  // shape now - otherwise the team plays its first spell out of position.
  computeHomePositions(team);
  placeAtHome(team);
  // placeAtHome just unconditionally snapped every player - including
  // whichever one doKickoff's earlier call to beginRestart placed dead
  // centre as the kickoff taker - back to their (now-different) formation
  // slot. The ball tracks its owner every frame (see updateBall), so
  // without this it visibly drifts off-centre onto that player's new spot.
  // Re-take the kickoff now that the real formation/kicker is known.
  if (G.restart && G.restart.kind === 'kickoff' && G.ball.owner && team.players.includes(G.ball.owner)) {
    const kicker = team.players.find(p => p.group === 'MID' && Math.abs(p.slot.y - 0.5) < 0.01) || outfield(team)[0];
    beginRestart(kicker, CENTER_POS, CENTER_CIRCLE_R + 0.3, 'kickoff');
  }
}

// Real penalty shootouts are famously close to a coin-flip regardless of
// overall team quality - a small nudge from relative strength, not a big
// swing either way. Used wherever a cup tie is level and needs a genuine
// winner instead of just eliminating the better (or unluckier) team.
function simCupPensDecider(myStrength, oppStrength) {
  const total = myStrength + oppStrength || 1;
  const winChance = clamp(0.5 + (myStrength - oppStrength) / total * 0.3, 0.35, 0.65);
  return Math.random() < winChance;
}

// Every fixture actually played (league, cup, European group leg, European
// knockout leg) gets one row here - the Career History screen's Match Log
// reads straight from this. resultOverride lets facup/leaguecup force a W/L
// (never D) once a level scoreline has already been through
// simCupPensDecider - the raw gf/ga stays the true scoreline either way.
function pushCareerMatchLog(fixture, gf, ga, resultOverride) {
  CAREER.matchLog = CAREER.matchLog || [];
  CAREER.matchLog.push({
    season: CAREER.seasonNumber,
    oppIdx: fixture.oppIdx,
    gf, ga,
    competition: fixtureCompetitionLabel(fixture) || 'League',
    result: resultOverride || (gf > ga ? 'W' : gf === ga ? 'D' : 'L'),
  });
}

// Shared by both the live-match and sim paths. League fixtures update the
// table as normal; cup fixtures instead advance-or-eliminate that
// competition, paying out CUP_PRIZE the moment there are no rounds of that
// type left. A level scoreline in a cup tie (domestic or the aggregate of a
// European two-legged tie) goes to a simmed penalty shootout rather than
// just eliminating on a draw - a cup tie always ends in a genuine win or
// loss, same as it would in reality.
function applyCareerFixtureResult(fixture, gf, ga) {
  CAREER.seasonTrophies = CAREER.seasonTrophies || { facup: false, leaguecup: false, ucl: false, uel: false };
  if (fixture.type === 'league') {
    const r = CAREER.record;
    r.played++; r.gf += gf; r.ga += ga;
    if (gf > ga) { r.won++; r.points += 3; }
    else if (gf === ga) { r.drawn++; r.points += 1; }
    else { r.lost++; }
    CAREER.results.push({ oppIdx: fixture.oppIdx, gf, ga });
    pushCareerMatchLog(fixture, gf, ga);
    return;
  }
  if (fixture.type.endsWith('-group')) {
    CAREER.europeGroup.results.push({ oppIdx: fixture.oppIdx, gf, ga });
    pushCareerMatchLog(fixture, gf, ga);
    if (CAREER.europeGroup.results.length >= 3) resolveEuropeGroup();
    return;
  }
  if (fixture.type.endsWith('-knockout')) {
    const comp = fixture.type.startsWith('ucl') ? 'ucl' : 'uel';
    const winPrize = comp === 'ucl' ? UCL_WIN_PRIZE : UEL_WIN_PRIZE;
    // Two-legged tie: leg 1 just records its score and waits - the
    // advance/eliminate decision only ever happens once leg 2's aggregate is
    // known (see resolveEuropeGroup for where both legs get scheduled). Each
    // leg is still its own played match, so it still gets its own log row
    // and its own honest W/D/L (a single leg drawing is normal, no decider
    // needed at that level - the decider only ever applies to the aggregate).
    pushCareerMatchLog(fixture, gf, ga);
    if (fixture.leg === 1) {
      CAREER.pendingKnockoutLeg1 = { gf, ga };
      showToast(`Leg 1: ${gf}-${ga} vs ${ALL_CLUBS[fixture.oppIdx].name}`, '#93c5fd');
      return;
    }
    const leg1 = CAREER.pendingKnockoutLeg1 || { gf: 0, ga: 0 };
    const aggGf = leg1.gf + gf, aggGa = leg1.ga + ga;
    CAREER.pendingKnockoutLeg1 = null;
    let wonTie = aggGf > aggGa;
    let decidedByPens = false;
    if (aggGf === aggGa) {
      wonTie = simCupPensDecider(careerSquadStrength(), effectiveClub(fixture.oppIdx).strength || 1);
      decidedByPens = true;
    }
    if (wonTie) {
      const roundsLeft = CAREER.fixtures.some((f, i) => i > CAREER.fixtureIdx && f.type === fixture.type);
      if (!roundsLeft) {
        CAREER.budget += winPrize;
        if (comp === 'ucl') CAREER.uclTitlesWon++; else CAREER.uelTitlesWon++;
        const lt = loadLifetime();
        const ltKey = comp === 'ucl' ? 'uclWon' : 'uelWon';
        lt[ltKey] = (lt[ltKey] || 0) + 1;
        saveLifetime(lt);
        CAREER.seasonTrophies[comp] = true;
        showToast(`🏆 Won the ${fixtureCompetitionLabel(fixture)} ${aggGf}-${aggGa}${decidedByPens ? ' on pens' : ' on aggregate'}! +£${winPrize}m`, '#ffd54f');
        CAREER.europeGroup = null;
      } else if (decidedByPens) {
        showToast(`Won on penalties ${aggGf}-${aggGa} on aggregate vs ${ALL_CLUBS[fixture.oppIdx].name}!`, '#4ade80');
      }
    } else {
      CAREER.fixtures = CAREER.fixtures.filter((f, i) => !(i > CAREER.fixtureIdx && f.type === fixture.type));
      showToast(`${decidedByPens ? 'Lost on penalties, e' : 'E'}liminated from the ${fixtureCompetitionLabel(fixture)} ${aggGf}-${aggGa}${decidedByPens ? '' : ' on aggregate'}`, '#e63946');
      CAREER.europeGroup = null;
    }
    return;
  }
  // facup / leaguecup - a level scoreline after 90 minutes goes to a simmed
  // penalty shootout instead of auto-eliminating.
  let wonTie = gf > ga;
  let decidedByPens = false;
  if (gf === ga) {
    wonTie = simCupPensDecider(careerSquadStrength(), effectiveClub(fixture.oppIdx).strength || 1);
    decidedByPens = true;
  }
  pushCareerMatchLog(fixture, gf, ga, wonTie ? 'W' : 'L');
  if (wonTie) {
    const roundsLeft = CAREER.fixtures.some((f, i) => i > CAREER.fixtureIdx && f.type === fixture.type);
    if (!roundsLeft) {
      CAREER.budget += CUP_PRIZE;
      if (fixture.type === 'facup') CAREER.faCupsWon++; else CAREER.leagueCupsWon++;
      CAREER.seasonTrophies[fixture.type] = true;
      showToast(`🏆 Won the ${fixtureCompetitionLabel(fixture)}${decidedByPens ? ' on penalties' : ''}! +£${CUP_PRIZE}m`, '#ffd54f');
    } else if (decidedByPens) {
      showToast(`Won on penalties vs ${ALL_CLUBS[fixture.oppIdx].name}!`, '#4ade80');
    }
  } else {
    CAREER.fixtures = CAREER.fixtures.filter((f, i) => !(i > CAREER.fixtureIdx && f.type === fixture.type));
    showToast(`${decidedByPens ? 'Lost on penalties, e' : 'E'}liminated from the ${fixtureCompetitionLabel(fixture)}`, '#e63946');
  }
}

// Fires the moment your 3rd European group fixture resolves. The 2 games
// between your 3 opponents (that don't involve you) aren't played out for
// real - they're resolved the same way "sim next fixture" resolves any
// other match, via simulateFixture, so the group table is a mix of real
// results (yours) and simulated ones (everyone else's), built once rather
// than tracked live all season.
function resolveEuropeGroup() {
  const { comp, oppIdxs, results } = CAREER.europeGroup;
  const points = { you: 0 }, gd = { you: 0 };
  oppIdxs.forEach(i => { points[i] = 0; gd[i] = 0; });
  const addResult = (a, b, gfA, gfB) => {
    if (gfA > gfB) points[a] += 3;
    else if (gfA === gfB) { points[a] += 1; points[b] += 1; }
    else points[b] += 3;
    gd[a] += gfA - gfB;
    gd[b] += gfB - gfA;
  };
  results.forEach(r => addResult('you', r.oppIdx, r.gf, r.ga));
  for (let i = 0; i < oppIdxs.length; i++) {
    for (let j = i + 1; j < oppIdxs.length; j++) {
      const a = oppIdxs[i], b = oppIdxs[j];
      const sim = simulateFixture(effectiveClub(a).strength || 1, effectiveClub(b).strength || 1);
      addResult(a, b, sim.home, sim.away);
    }
  }
  const table = [{ id: 'you', points: points.you, gd: gd.you }, ...oppIdxs.map(i => ({ id: i, points: points[i], gd: gd[i] }))]
    .sort((a, b) => b.points - a.points || b.gd - a.gd);
  const advanced = table.slice(0, 2).some(row => row.id === 'you');
  const label = COMPETITION_LABEL[`${comp}-group`];
  if (advanced) {
    const advanceBonus = comp === 'ucl' ? UCL_ADVANCE_BONUS : UEL_ADVANCE_BONUS;
    CAREER.budget += advanceBonus;
    showToast(`⚽ Through to the ${label} knockout stage! +£${advanceBonus}m`, '#4ade80');
    const knockoutRounds = comp === 'ucl' ? ['Semi-Final', 'Final'] : ['Final'];
    const pool = europeStrengthBand('top').filter(i => !oppIdxs.includes(i));
    const knockoutOpps = shuffled(pool).slice(0, knockoutRounds.length)
      .sort((a, b) => (effectiveClub(a).strength || 1) - (effectiveClub(b).strength || 1)); // tougher as rounds progress, e.g. the Final is toughest
    // Two-legged (home + away, aggregate score) rather than one-off matches -
    // each round gets a Leg 1 and Leg 2 fixture back to back; see
    // applyCareerFixtureResult's '-knockout' branch for how the aggregate is
    // resolved once leg 2 is played.
    let insertAt = CAREER.fixtureIdx + 1;
    knockoutRounds.forEach((_, i) => {
      CAREER.fixtures.splice(insertAt, 0,
        { type: `${comp}-knockout`, oppIdx: knockoutOpps[i], round: i, leg: 1 },
        { type: `${comp}-knockout`, oppIdx: knockoutOpps[i], round: i, leg: 2 });
      insertAt += 2;
    });
    CAREER.europeGroup = null;
  } else {
    showToast(`Eliminated from the ${label} group stage`, '#e63946');
    CAREER.europeGroup = null;
  }
}

function recordCareerResult() {
  const fixture = CAREER.fixtures[CAREER.fixtureIdx];
  const gf = G.teams[0].score, ga = G.teams[1].score;
  applyCareerFixtureResult(fixture, gf, ga);
  CAREER.fixtureIdx++;
  G.allMatchPlayers.forEach(p => {
    if (!p.careerId || !p.goals) return;
    const cp = CAREER.squad.find(c => c.id === p.careerId);
    if (cp) cp.careerGoals = (cp.careerGoals || 0) + p.goals;
  });
  if (CAREER.fixtureIdx >= CAREER.fixtures.length) endCareerSeason();
  saveCareerSlot(CAREER.slot, CAREER);
}

// A quick statistical scoreline for a fixture you chose not to play live - no
// physics/AI engine involved. forStrength/againstStrength are plain
// multipliers, the same rough 0.6-1.5 range every other strength/teamFactor
// number in this file already uses. The decaying-chance loop stands in for a
// Poisson draw without needing a real distribution library.
function simulateGoals(forStrength, againstStrength) {
  const expected = clamp(1.35 * (forStrength / againstStrength), 0.2, 4.5);
  let goals = 0;
  while (Math.random() < expected / (goals + expected + 1) && goals < 9) goals++;
  return goals;
}
function simulateFixture(homeStrength, awayStrength) {
  return { home: simulateGoals(homeStrength, awayStrength), away: simulateGoals(awayStrength, homeStrength) };
}
function careerSquadStrength() {
  if (!CAREER.squad.length) return ALL_CLUBS[CAREER.clubIdx].strength || 1;
  return CAREER.squad.reduce((sum, cp) => sum + (cp.pace + cp.tackling + cp.finishing + cp.reflexes) / 4, 0) / CAREER.squad.length;
}
function careerSimNextFixture() {
  const fixture = CAREER.fixtures[CAREER.fixtureIdx];
  const oppIdx = fixture.oppIdx;
  const result = simulateFixture(careerSquadStrength(), effectiveClub(oppIdx).strength || 1);
  applyCareerFixtureResult(fixture, result.home, result.away);
  CAREER.fixtureIdx++;
  const resultColor = result.home > result.away ? '#4ade80' : result.home === result.away ? '#9ca3af' : '#e63946';
  const compLabel = fixtureCompetitionLabel(fixture);
  const label = compLabel ? `${compLabel}: ` : '';
  showToast(`${label}${ALL_CLUBS[CAREER.clubIdx].name} ${result.home}-${result.away} ${ALL_CLUBS[oppIdx].name}`, resultColor);
  if (CAREER.fixtureIdx >= CAREER.fixtures.length) endCareerSeason();
  saveCareerSlot(CAREER.slot, CAREER);
}

// Aging/progression/generation cycle - fires once the fixture list runs out,
// whether the last fixture was played live or simmed.
function endCareerSeason() {
  CAREER.squad = CAREER.squad.filter(cp => {
    cp.age++;
    if (cp.age >= 36) return false; // retires - drops out of the squad entirely
    const avg = (cp.pace + cp.tackling + cp.finishing + cp.reflexes) / 4;
    let delta;
    if (avg < cp.potential - 0.02) delta = rand(0.01, 0.04); // still room to grow toward potential
    else if (cp.age <= 29) delta = rand(-0.01, 0.01); // prime years - roughly stable
    else delta = -rand(0.01, cp.age >= 33 ? 0.05 : 0.03); // decline, faster past 33
    ['pace', 'tackling', 'finishing', 'reflexes'].forEach(attr => {
      cp[attr] = clamp(cp[attr] + delta + rand(-0.02, 0.02), 0.4, 1.5);
    });
    cp.value = computePlayerValue(cp);
    return true;
  });
  if (CAREER.seasonNumber >= CAREER.nextGenerationSeason) {
    CAREER.freeAgents.push(...generateRegenBatch());
    CAREER.nextGenerationSeason = CAREER.seasonNumber + 1 + Math.floor(rand(3, 5));
  }
  // The rest of the football world moves on too - every club's strength
  // drifts a little and its squad gradually refreshes, see evolveWorldClub.
  ALL_CLUBS.forEach((c, i) => evolveWorldClub(i));
  generateIncomingOffers();
  // Finishing top of the (estimated) table, not just clearing a fixed points
  // bar - ties the title directly to the same standings the table screen
  // shows, so "champions" always matches what you'd have seen there.
  const finalTable = [{ clubIdx: CAREER.clubIdx, points: CAREER.record.points, gd: CAREER.record.gf - CAREER.record.ga }, ...CAREER.tableEstimate]
    .sort((a, b) => b.points - a.points || b.gd - a.gd);
  const finalRank = finalTable.findIndex(row => row.clubIdx === CAREER.clubIdx) + 1;
  const wasChampion = finalTable[0].clubIdx === CAREER.clubIdx;
  if (wasChampion) {
    CAREER.budget += LEAGUE_TITLE_PRIZE;
    CAREER.leagueTitlesWon++;
    showToast(`🏆 Champions! +£${LEAGUE_TITLE_PRIZE}m`, '#ffd54f');
  }
  // European qualification for NEXT season - same finalRank used for the
  // title check above, judged against the league you actually just finished
  // in (before promotion/relegation below can change CAREER.clubLeague).
  // Championship never qualifies, matching reality - see EUROPE_ELIGIBLE_LEAGUES.
  if (EUROPE_ELIGIBLE_LEAGUES.includes(CAREER.clubLeague)) {
    if (finalRank <= 4) {
      CAREER.europeCompetition = 'ucl';
      CAREER.budget += UCL_QUALIFY_BONUS;
      showToast(`⭐ Qualified for the Champions League! +£${UCL_QUALIFY_BONUS}m`, '#4ade80');
    } else if (finalRank <= 6) {
      CAREER.europeCompetition = 'uel';
      CAREER.budget += UEL_QUALIFY_BONUS;
      showToast(`⭐ Qualified for the Europa League! +£${UEL_QUALIFY_BONUS}m`, '#4ade80');
    } else {
      CAREER.europeCompetition = null;
    }
  } else {
    CAREER.europeCompetition = null;
  }
  // Promotion/relegation - Premier League <-> Championship only, simplified
  // to a straight cutoff (no playoff for 3rd, unlike the real Championship).
  // Only your own club's division ever changes - the other clubs in
  // ALL_CLUBS stay tagged with their original league permanently, see
  // CAREER.clubLeague's own comment.
  const leaguePlayedIn = CAREER.clubLeague; // captured before any reassignment below, for seasonHistory
  let wasPromoted = false, wasRelegated = false;
  if (CAREER.clubLeague === 'Premier League' && finalRank > finalTable.length - 3) {
    CAREER.clubLeague = 'EFL Championship';
    wasRelegated = true;
    showToast('⬇️ Relegated to the Championship', '#e63946');
  } else if (CAREER.clubLeague === 'EFL Championship' && finalRank <= 3) {
    CAREER.clubLeague = 'Premier League';
    wasPromoted = true;
    showToast('⬆️ Promoted to the Premier League!', '#4ade80');
  }
  // One row for the History screen - captures everything about the season
  // that just ended before the record/trophy tracking below resets for the
  // next one. See showSeasonCompleteOverlay/renderCareerHistoryScreen.
  CAREER.seasonHistory = CAREER.seasonHistory || [];
  CAREER.seasonTrophies = CAREER.seasonTrophies || { facup: false, leaguecup: false, ucl: false, uel: false };
  const seasonSummary = {
    season: CAREER.seasonNumber,
    league: leaguePlayedIn,
    leagueSize: finalTable.length,
    finalRank,
    record: { ...CAREER.record },
    champion: wasChampion,
    promoted: wasPromoted,
    relegated: wasRelegated,
    trophies: { ...CAREER.seasonTrophies },
  };
  CAREER.seasonHistory.push(seasonSummary);
  CAREER.lastSeasonSummary = seasonSummary;
  CAREER.seasonTrophies = { facup: false, leaguecup: false, ucl: false, uel: false };
  CAREER.budget += 15 + CAREER.record.points; // simple prize-money-ish top-up
  CAREER.seasonNumber++;
  CAREER.fixtures = buildCareerFixtures(CAREER.clubIdx);
  CAREER.fixtureIdx = 0;
  CAREER.record = { played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0 };
  CAREER.results = [];
  CAREER.tableEstimate = generateLeagueTableEstimate(CAREER.clubIdx);
}

// Every signable player right now: your own free-agent pool (released
// players + generated regens) plus every real name at every ALL_CLUBS club
// outside your own current division (so you're never buying straight from a
// league rival). Those club players don't have attributes until first
// viewed here - once generated they're cached on that club entry so the
// same "person" doesn't re-roll a different rating every time the market's
// opened.
function getTransferPool() {
  const pool = CAREER.freeAgents.slice();
  ALL_CLUBS.forEach((_, i) => {
    if (i === CAREER.clubIdx) return; // never your own club - everyone else, including your own league's rivals, is fair game
    const club = effectiveClub(i);
    // Cached per-save (CAREER.worldState[i].generated), not on the shared
    // ALL_CLUBS object - a name generated in one save shouldn't be assumed
    // to exist, or have the same rolled attributes, in another (especially
    // now squad names themselves can differ per-save, see evolveWorldClub).
    const w = ensureWorldState(i);
    Object.keys(club.squad).forEach(group => {
      const names = club.squad[group];
      names.forEach((name, gi) => {
        if (!w.generated[name]) {
          // A name signPlayer just replaced someone with rolls as a young,
          // unproven prospect - lower age, no star-listing premium, more
          // room to grow (see makeCareerPlayer's own potential handling) -
          // rather than instantly being "just as good" as whoever left.
          const isYoung = (w.youngNames || []).includes(name);
          const age = isYoung ? randPlayerAge(17, 20) : resolvePlayerAge(name, 19, 32);
          const factor = isYoung ? (club.strength || 1.05) * 0.8 : (club.strength || 1.05) * renownFactor(gi, names.length);
          const cp = makeCareerPlayer(name, group, factor, age);
          cp.league = club.league;
          cp.club = club.name;
          cp.clubIdx = i; // lets signPlayer find its way back to this club's own worldState entry
          w.generated[name] = cp;
        }
        pool.push(w.generated[name]);
      });
    });
  });
  return pool;
}

function signPlayer(cp) {
  if (CAREER.budget < cp.value) return false;
  if (CAREER.squad.some(p => p.id === cp.id)) return false; // already signed - guards a stale button reference from a pre-reflow render
  CAREER.budget -= cp.value;
  CAREER.freeAgents = CAREER.freeAgents.filter(p => p.id !== cp.id);
  // A signing from another club needs pulling out of that club's cache too,
  // or it would still show up as browsable/signable a second time.
  Object.values(CAREER.worldState || {}).forEach(w => {
    if (!w.generated) return;
    Object.keys(w.generated).forEach(name => { if (w.generated[name].id === cp.id) delete w.generated[name]; });
  });
  // Signing someone away from a real club actually depletes that club's own
  // squad - their name comes off the roster entirely (not just the
  // attribute cache above), or the transfer market would just keep
  // re-rolling a "new" version of the same person at the same price/age
  // forever. The club brings in a fresh young replacement of its own,
  // landing at the end of the list (lowest renownFactor) rather than
  // stepping straight into the departed star's old spot.
  if (cp.clubIdx != null) {
    const w = ensureWorldState(cp.clubIdx);
    const list = w.squad[cp.group];
    const idx = list.indexOf(cp.name);
    if (idx !== -1) list.splice(idx, 1);
    const prospect = generateRegenName();
    list.push(prospect);
    w.youngNames = w.youngNames || [];
    w.youngNames.push(prospect);
  }
  // Once they're actually on your squad, drop the "came from X club" tag -
  // formatCareerPlayerRow only shows it to distinguish transfer-market
  // listings by source club; leaving it set would keep showing their old
  // club forever in your own squad/lineup lists, which reads as if they
  // still play for someone else.
  delete cp.league;
  delete cp.club;
  delete cp.clubIdx;
  CAREER.squad.push(cp);
  saveCareerSlot(CAREER.slot, CAREER);
  return true;
}

function releasePlayer(cp) {
  CAREER.squad = CAREER.squad.filter(p => p.id !== cp.id);
  CAREER.budget += Math.round(cp.value * 0.5);
  saveCareerSlot(CAREER.slot, CAREER);
}

let careerNextOfferId = 1;

// A handful of other clubs occasionally want to buy one of YOUR players -
// an independent OFFER_CHANCE_PER_PLAYER chance per squad player, capped at
// MAX_OFFERS_PER_SEASON so a long career doesn't get buried in offers to
// review. Replaces (doesn't stack onto) whatever was left over unreviewed
// from the previous season - a real transfer window closes, it doesn't
// carry every old offer forward forever.
function generateIncomingOffers() {
  const otherClubIdxs = ALL_CLUBS.map((c, i) => i).filter(i => i !== CAREER.clubIdx);
  const candidates = shuffled(CAREER.squad).filter(() => Math.random() < OFFER_CHANCE_PER_PLAYER).slice(0, MAX_OFFERS_PER_SEASON);
  CAREER.incomingOffers = candidates.map(cp => {
    const clubIdx = otherClubIdxs[Math.floor(Math.random() * otherClubIdxs.length)];
    return {
      id: careerNextOfferId++,
      playerId: cp.id,
      playerName: cp.name,
      playerGroup: cp.group,
      clubIdx,
      clubName: ALL_CLUBS[clubIdx].name,
      amount: Math.max(1, Math.round(cp.value * rand(0.85, 1.15))),
    };
  });
}

// Shared by Accept, every counter tier, and Reject - resolves one offer and
// always removes it from the queue, whichever way it goes.
function resolveOffer(offerId, finalPrice) {
  const offer = CAREER.incomingOffers.find(o => o.id === offerId);
  if (!offer) return;
  CAREER.incomingOffers = CAREER.incomingOffers.filter(o => o.id !== offerId);
  if (finalPrice == null) { saveCareerSlot(CAREER.slot, CAREER); return; } // rejected - no money, player stays
  CAREER.squad = CAREER.squad.filter(p => p.id !== offer.playerId);
  CAREER.budget += Math.round(finalPrice * SELL_CUT);
  saveCareerSlot(CAREER.slot, CAREER);
}

// ---------- Penalty shootout ----------
// A self-contained mini-game, deliberately kept separate from the live match
// simulation (own overlay, own input handling) - your kicks are interactive
// (hold to charge power, release to strike, same feel as an in-match shot),
// the opposition's kicks resolve automatically after a short suspense pause.
const SHOOTOUT_BEST_OF = 5;
let SHOOT = null; // { homeResults[], awayResults[], homeTakers[], awayTakers[], turn, sudden, charging, chargeStart }

function startShootout() {
  SHOOT = {
    homeResults: [], awayResults: [],
    homeTakers: outfield(G.teams[0]).slice().sort((a, b) => b.finishing - a.finishing),
    awayTakers: outfield(G.teams[1]).slice().sort((a, b) => b.finishing - a.finishing),
    turn: 0, // 0 = home (you) to kick next, 1 = away (AI) to kick next
    sudden: false,
    charging: false,
    chargeStart: 0,
  };
  document.getElementById('shootout-overlay').classList.remove('hidden');
  SFX.setCrowdTension(0.9); // no bigger moment in the match than a shootout
  renderShootout();
  scheduleNextShootoutKick();
}

function shootoutCurrentTaker(team) {
  const list = team === 0 ? SHOOT.homeTakers : SHOOT.awayTakers;
  const results = team === 0 ? SHOOT.homeResults : SHOOT.awayResults;
  return list[results.length % list.length];
}

function scheduleNextShootoutKick() {
  if (SHOOT.turn === 1) {
    setTimeout(() => { if (SHOOT) takeAiShootoutKick(); }, 900); // a beat of suspense before the AI's kick
  }
  // turn 0 (human) just waits for the kick button / shoot key
}

function takeAiShootoutKick() {
  resolveShootoutKick(1, null);
}

function shootoutSuccessChance(team, power) {
  const taker = shootoutCurrentTaker(team);
  const gk = G.teams[1 - team].players.find(p => p.isGK);
  let chance = 0.78;
  if (power != null) {
    // a sweet spot around 0.55-0.85 power; rushed or over-cooked kicks are easier to save
    const penalty = power < 0.3 ? (0.3 - power) * 0.9 : power > 0.95 ? (power - 0.95) * 1.6 : 0;
    chance -= penalty;
  }
  chance *= taker.finishing;
  chance -= (gk.reflexes - 1) * 0.15;
  return clamp(chance, 0.15, 0.95);
}

function checkShootoutDecided() {
  const hs = SHOOT.homeResults, as = SHOOT.awayResults;
  const hScore = hs.filter(Boolean).length, aScore = as.filter(Boolean).length;
  if (!SHOOT.sudden) {
    const hRemaining = Math.max(0, SHOOTOUT_BEST_OF - hs.length);
    const aRemaining = Math.max(0, SHOOTOUT_BEST_OF - as.length);
    if (hScore > aScore + aRemaining) return true;
    if (aScore > hScore + hRemaining) return true;
    return false;
  }
  // sudden death: decided as soon as both sides have taken the same number of
  // kicks since the tie-breaker started, and the scores aren't level
  const suddenHome = hs.length - SHOOTOUT_BEST_OF, suddenAway = as.length - SHOOTOUT_BEST_OF;
  return suddenHome === suddenAway && suddenHome > 0 && hScore !== aScore;
}

function resolveShootoutKick(team, power) {
  const scored = Math.random() < shootoutSuccessChance(team, power);
  (team === 0 ? SHOOT.homeResults : SHOOT.awayResults).push(scored);
  SFX[scored ? 'kick' : 'catch']();
  if (scored) vibrate(20);
  renderShootout();
  if (checkShootoutDecided()) {
    concludeShootout();
    return;
  }
  if (!SHOOT.sudden && SHOOT.homeResults.length >= SHOOTOUT_BEST_OF && SHOOT.awayResults.length >= SHOOTOUT_BEST_OF) {
    SHOOT.sudden = true;
  }
  SHOOT.turn = team === 0 ? 1 : 0;
  scheduleNextShootoutKick();
}

function concludeShootout() {
  const result = {
    homePens: SHOOT.homeResults.filter(Boolean).length,
    awayPens: SHOOT.awayResults.filter(Boolean).length,
  };
  document.getElementById('shootout-overlay').classList.add('hidden');
  SHOOT = null;
  finalizeFulltime(result);
}

function renderShootout() {
  const dotsHtml = (results) => {
    let html = '';
    for (let i = 0; i < Math.max(results.length, SHOOTOUT_BEST_OF); i++) {
      if (i < results.length) html += `<span class="pk-dot ${results[i] ? 'pk-score' : 'pk-miss'}"></span>`;
      else if (i < SHOOTOUT_BEST_OF) html += '<span class="pk-dot pk-pending"></span>';
    }
    return html;
  };
  document.getElementById('shootout-home-name').textContent = document.getElementById('score-home-name').textContent;
  document.getElementById('shootout-away-name').textContent = document.getElementById('score-away-name').textContent;
  document.getElementById('shootout-home-score').textContent = SHOOT.homeResults.filter(Boolean).length;
  document.getElementById('shootout-away-score').textContent = SHOOT.awayResults.filter(Boolean).length;
  document.getElementById('shootout-home-dots').innerHTML = dotsHtml(SHOOT.homeResults);
  document.getElementById('shootout-away-dots').innerHTML = dotsHtml(SHOOT.awayResults);
  const kickBtn = document.getElementById('btn-shootout-kick');
  const prompt = document.getElementById('shootout-prompt');
  if (SHOOT.turn === 0) {
    prompt.textContent = 'Your kick - hold to charge power, release to strike!';
    kickBtn.classList.remove('hidden');
  } else {
    prompt.textContent = `${document.getElementById('shootout-away-name').textContent} are stepping up...`;
    kickBtn.classList.add('hidden');
  }
}

function updateShootoutChargeBar() {
  const bar = document.getElementById('shootout-power-fill');
  if (!bar) return;
  if (SHOOT && SHOOT.charging) {
    const power = clamp((performance.now() - SHOOT.chargeStart) / 1000, 0, 2) / 2;
    bar.style.width = (power * 100) + '%';
  } else {
    bar.style.width = '0%';
  }
}

function startShootoutCharge() {
  if (SHOOT && SHOOT.turn === 0 && !SHOOT.charging) {
    SHOOT.charging = true;
    SHOOT.chargeStart = performance.now();
  }
}

function releaseShootoutCharge() {
  if (SHOOT && SHOOT.charging) {
    const power = clamp((performance.now() - SHOOT.chargeStart) / 1000, 0, 2) / 2;
    SHOOT.charging = false;
    resolveShootoutKick(0, power);
  }
}

// ---------- Practice mode ----------
// A self-contained mini-mode, deliberately not routed through the normal
// match engine (update/doKickoff/checkOutOfBounds etc all assume a full
// 22-player match with restarts, a clock, two halves) - reusing the human
// movement + charge-and-release shot input, but with its own lightweight
// ball physics/resolution loop so a wide shot just resets to the next rep
// instead of triggering a goal-kick/throw-in.
const PRACTICE_WALL_DIST = 9.15; // metres - the real free-kick wall distance
let PRACTICE = null; // { mode: 'penalty'|'freekick', yourIdx, skillKey, attempts, makes, gk, wallPlayers, resolved }

function banishPlayer(p, x, y) {
  p.pos = { x, y };
  p.vel = { x: 0, y: 0 };
}

function updatePracticeScoreboard() {
  document.getElementById('match-clock').textContent = PRACTICE.mode === 'penalty' ? 'PENALTIES' : 'FREE KICKS';
  document.getElementById('half-label').textContent = `${PRACTICE.makes} / ${PRACTICE.attempts}`;
}

// Swaps the pause button over to a direct "quit" while in practice (there's
// no clock/halves to actually pause), and back to its normal behaviour
// otherwise - see goToMainMenu, which always resets this.
function updatePauseButtonForPractice(inPractice) {
  const btn = document.getElementById('btn-pause');
  btn.onclick = inPractice ? goToMainMenu : togglePause;
}

function startPractice(yourIdx, mode, skillKey) {
  const oppIdx = (yourIdx + 1) % TEAMS.length;
  G.teams[0] = buildTeam(TEAMS[yourIdx], 1, GK_COLORS[0], 0, skillKey);
  G.teams[1] = buildTeam(TEAMS[oppIdx], -1, GK_COLORS[1], 1, skillKey);
  tagTeams();
  G.skill = SKILLS[skillKey];
  G.keysDown = {};
  G.charge = { pass: false, shoot: false, passStart: 0, shootStart: 0 };
  G.isNightMatch = Math.random() < NIGHT_MATCH_CHANCE;
  rollWeather();

  document.getElementById('score-home-name').textContent = TEAMS[yourIdx].name;
  document.getElementById('score-away-name').textContent = 'Practice';
  document.getElementById('score-home').textContent = '';
  document.getElementById('score-away').textContent = '';
  const homePanel = document.getElementById('score-panel-home');
  const awayPanel = document.getElementById('score-panel-away');
  homePanel.style.setProperty('--panel-color', TEAMS[yourIdx].shirt);
  homePanel.style.setProperty('--panel-text', readableTextColor(TEAMS[yourIdx].shirt));
  awayPanel.style.setProperty('--panel-color', '#333333');
  awayPanel.style.setProperty('--panel-text', '#ffffff');

  // Only the shooter, the keeper, and (for free kicks) a wall take any part -
  // everyone else is parked off in a corner, out of the way.
  const shooter = outfield(G.teams[0]).slice().sort((a, b) => b.finishing - a.finishing)[0];
  for (const p of G.teams[0].players) if (p !== shooter) banishPlayer(p, -8, -8);
  const gk = G.teams[1].players.find(p => p.isGK);
  const wallPlayers = mode === 'freekick' ? outfield(G.teams[1]).slice(0, 3) : [];
  for (const p of G.teams[1].players) {
    if (p === gk || wallPlayers.includes(p)) continue;
    banishPlayer(p, -8, PITCH_WID + 8);
  }

  PRACTICE = { mode, yourIdx, skillKey, attempts: 0, makes: 0, gk, wallPlayers, resolved: true, saveAttempted: false, gkCommitted: false, gkDiveSide: 0 };
  G.controlled = shooter;
  updatePauseButtonForPractice(true);
  updatePracticeScoreboard();
  SFX.startCrowdAmbience();
  requestMobileFullscreen();
  nextPracticeAttempt();
  G.state = STATE.PRACTICE;
}

// Places the ball (and, for a free kick, a fresh random spot + wall) ready
// for the next rep.
function nextPracticeAttempt() {
  G.shotAim = 0;
  const goalY = PITCH_WID / 2;
  let spot;
  if (PRACTICE.mode === 'penalty') {
    spot = { x: PITCH_LEN - PEN_SPOT_DIST, y: goalY };
  } else {
    const d = rand(18, 28);
    const angle = rand(-35, 35) * Math.PI / 180;
    spot = { x: PITCH_LEN - d * Math.cos(angle), y: clamp(goalY + d * Math.sin(angle), 8, PITCH_WID - 8) };
  }

  const toGoal = norm(sub({ x: PITCH_LEN, y: goalY }, spot));
  G.controlled.pos = { x: spot.x, y: spot.y };
  G.controlled.vel = { x: 0, y: 0 };
  G.controlled.facing = toGoal;
  G.ball.owner = G.controlled;
  G.ball.pos = { x: spot.x, y: spot.y };
  G.ball.vel = { x: 0, y: 0 };
  G.ball.kickImmuneFrom = null;
  G.ball.lastTouchTeam = 0;

  PRACTICE.gk.pos = { x: PITCH_LEN - 1.5, y: goalY };
  PRACTICE.gk.vel = { x: 0, y: 0 };

  if (PRACTICE.wallPlayers.length) {
    const wallCenter = { x: spot.x + toGoal.x * PRACTICE_WALL_DIST, y: spot.y + toGoal.y * PRACTICE_WALL_DIST };
    const perp = { x: -toGoal.y, y: toGoal.x };
    const n = PRACTICE.wallPlayers.length;
    PRACTICE.wallPlayers.forEach((p, i) => {
      const offset = (i - (n - 1) / 2) * 1.1;
      p.pos = { x: wallCenter.x + perp.x * offset, y: wallCenter.y + perp.y * offset };
      p.vel = { x: 0, y: 0 };
      p.facing = { x: -toGoal.x, y: -toGoal.y };
    });
  }

  PRACTICE.resolved = false;
  PRACTICE.saveAttempted = false;
  PRACTICE.gkCommitted = false;
  PRACTICE.gkDiveSide = 0;
  updatePracticeScoreboard();
}

// Called the instant the shot is struck (not while it's in flight) - the
// keeper reads the taker's aim, not the ball itself, and picks one of three
// fixed spots to commit to. Mirrors a real penalty: keepers commit to a
// side very early and can't course-correct mid-dive, rather than being able
// to track the ball's exact position all the way to the line.
function decidePracticeGKDive(aim) {
  const gk = PRACTICE.gk;
  const trueSide = aim > 0.25 ? 1 : aim < -0.25 ? -1 : 0;
  const readChance = clamp(0.3 + (gk.reflexes - 1) * 0.5, 0.15, 0.75);
  if (Math.random() < readChance) {
    PRACTICE.gkDiveSide = trueSide;
  } else {
    const otherSides = [-1, 0, 1].filter(s => s !== trueSide);
    PRACTICE.gkDiveSide = otherSides[Math.floor(Math.random() * otherSides.length)];
  }
  PRACTICE.gkCommitted = true;
}

function resolvePracticeAttempt(scored, message) {
  if (PRACTICE.resolved) return;
  PRACTICE.resolved = true;
  PRACTICE.gkCommitted = false;
  PRACTICE.attempts++;
  // Stop the ball dead the instant a result is declared - otherwise it kept
  // coasting on its old velocity for the rest of the pause before the next
  // rep, visibly sailing on through/past the goal even after "SAVED!" showed.
  G.ball.vel = { x: 0, y: 0 };
  if (scored) {
    PRACTICE.makes++;
    SFX.netHit();
    SFX.goal();
    shakeScreen();
  } else {
    SFX.whistle();
    if (message === 'SAVED!') G.ball.pos = { x: PRACTICE.gk.pos.x, y: PRACTICE.gk.pos.y }; // gathered in the keeper's hands
  }
  showToast(message, scored ? '#4ade80' : '#f87171');
  updatePracticeScoreboard();
  setTimeout(() => { if (PRACTICE) nextPracticeAttempt(); }, 1400);
}

// Simplified free-flight ball physics (same friction model as the live
// match's updateBall) plus its own goal/save/miss resolution - deliberately
// not the real checkGoalMouth/checkOutOfBounds, which assume a full match.
function updatePracticeBall(dt) {
  const b = G.ball;
  if (b.owner) {
    const facing = len(b.owner.facing) > 0.01 ? norm(b.owner.facing) : { x: 1, y: 0 };
    b.pos.x = b.owner.pos.x + facing.x * 0.35;
    b.pos.y = b.owner.pos.y + facing.y * 0.35;
    b.vel = { x: 0, y: 0 };
    return;
  }
  b.pos.x += b.vel.x * dt;
  b.pos.y += b.vel.y * dt;
  const speed = len(b.vel);
  b.spin += speed * dt * 0.6;
  if (speed > 0.01) {
    const decel = 3.2 * dt;
    const newSpeed = Math.max(0, speed - decel);
    const dir = norm(b.vel);
    b.vel = { x: dir.x * newSpeed, y: dir.y * newSpeed };
  } else {
    b.vel = { x: 0, y: 0 };
  }

  if (PRACTICE.resolved) return;

  const gk = PRACTICE.gk;
  // Only one save roll per attempt - the ball can spend several frames
  // within range of the keeper as it crosses the goal mouth, and re-rolling
  // every one of those frames compounded into a near-certain save (a keeper
  // sitting in the middle covers most of the goal within this radius, so it
  // was in range - and re-rolling - for almost every shot that wasn't aimed
  // right at a post).
  if (!PRACTICE.saveAttempted && dist(gk.pos, b.pos) < GK_SMOTHER_RADIUS + 0.6) {
    PRACTICE.saveAttempted = true;
    // Whether the keeper is even in range at all now depends on whether
    // decidePracticeGKDive guessed the right side - no need for the old
    // artificial x1.6 boost that compensated for a keeper who never moved.
    if (Math.random() < clamp(GK_SAVE_CHANCE * gk.reflexes * 1.2, 0.1, 0.95)) {
      resolvePracticeAttempt(false, 'SAVED!');
      return;
    }
  }
  const halfGoal = GOAL_WIDTH / 2;
  if (b.pos.x >= PITCH_LEN - 0.3 && Math.abs(b.pos.y - PITCH_WID / 2) <= halfGoal) {
    resolvePracticeAttempt(true, 'GOAL!');
    return;
  }
  const stopped = speed < 0.05;
  const wentWide = b.pos.x >= PITCH_LEN && Math.abs(b.pos.y - PITCH_WID / 2) > halfGoal;
  const wentOutSide = b.pos.y < 0 || b.pos.y > PITCH_WID;
  if (wentWide || wentOutSide || stopped) {
    resolvePracticeAttempt(false, 'MISS');
  }
}

// The keeper commits to one fixed spot (decidePracticeGKDive, called the
// instant the shot is struck) rather than continuously chasing the ball's
// exact live position - tracking the ball itself let the keeper reach every
// corner in time regardless of power, since it had perfect frame-by-frame
// knowledge of where the ball was heading with no reaction delay at all.
// Before a shot is struck it just eases back to the middle of the goal.
function updatePracticeGK(dt) {
  const gk = PRACTICE.gk;
  const goalY = PITCH_WID / 2;
  const halfGoal = GOAL_WIDTH / 2 - 0.6;
  if (PRACTICE.gkCommitted) {
    const targetY = goalY + PRACTICE.gkDiveSide * halfGoal;
    const diveSpeed = 6 * gk.reflexes;
    const step = clamp(targetY - gk.pos.y, -diveSpeed * dt, diveSpeed * dt);
    gk.pos.y += step;
  } else {
    gk.pos.y += (goalY - gk.pos.y) * clamp(dt * 2, 0, 1);
  }
  gk.pos.x = PITCH_LEN - 1.5;
}

function updatePractice(dt) {
  handleHumanMovement(dt);
  updatePracticeGK(dt);
  updatePracticeBall(dt);
  updateCamera(dt);
}

function initMatch(yourIdx, oppIdx, halfLenMin, skillKey) {
  lastMatchSettings = { yourIdx, oppIdx, halfLenMin, skillKey };
  initMatchWithClubs(TEAMS[yourIdx], TEAMS[oppIdx], halfLenMin, skillKey);
}

// Same as initMatch, but takes full club objects instead of TEAMS indices -
// lets Career mode start a match with any ALL_CLUBS entry (any league), not
// just the 20 Premier League clubs. initMatch itself is just a thin wrapper
// around this for Play/Season/Cup/Practice, which only ever deal with TEAMS.
function initMatchWithClubs(homeDef, oppDef, halfLenMin, skillKey) {
  // Your team always wears its home kit; the opposition switches to their
  // away strip if their home colours would be too close to yours to tell apart.
  // Not every club (new-league entries) has an `away` kit defined - fall back
  // to the home kit itself rather than crashing on oppKit.shirt below.
  const oppKit = (kitsClash(homeDef.shirt, oppDef.shirt) ? oppDef.away : null) || oppDef;
  G.teams[0] = buildTeam(homeDef, 1, GK_COLORS[0], 0, skillKey);
  G.teams[1] = buildTeam(oppDef, -1, GK_COLORS[1], 1, skillKey, oppKit);
  tagTeams();
  G.skill = SKILLS[skillKey];
  G.half = 1;
  G.elapsedSec = 0;
  G.displayedSec = -1;
  G.addedTimeSec = 0;
  G.addedTimeAnnounced = false;
  G.stoppageEvents = 0;
  G.extraTime = false;
  G.etHalf = 0;
  G.isNightMatch = Math.random() < NIGHT_MATCH_CHANCE;
  rollWeather();
  G.pendingScorer = null;
  G.allMatchPlayers = [...G.teams[0].players, ...G.teams[1].players];
  G.eventLog = [];
  const tickerEl = document.getElementById('event-ticker');
  if (tickerEl) tickerEl.innerHTML = '';
  pendingSubOut = null;
  G.keysDown = {};
  G.charge = { pass: false, shoot: false, passStart: 0, shootStart: 0 };
  G.halfLengthSec = halfLenMin * 60;
  G.stats = { shots: [0, 0], shotsOnTarget: [0, 0], tackles: [0, 0], fouls: [0, 0], corners: [0, 0], possession: [0, 0] };
  document.getElementById('score-home-name').textContent = homeDef.name;
  document.getElementById('score-away-name').textContent = oppDef.name;
  document.getElementById('score-home').textContent = '0';
  document.getElementById('score-away').textContent = '0';
  document.getElementById('half-label').textContent = '1st Half';
  const homePanel = document.getElementById('score-panel-home');
  const awayPanel = document.getElementById('score-panel-away');
  homePanel.style.setProperty('--panel-color', homeDef.shirt);
  homePanel.style.setProperty('--panel-text', readableTextColor(homeDef.shirt));
  awayPanel.style.setProperty('--panel-color', oppKit.shirt);
  awayPanel.style.setProperty('--panel-text', readableTextColor(oppKit.shirt));
  updateCardIndicators();
  SFX.startCrowdAmbience();
  requestMobileFullscreen();
  doKickoff(0);
  G.state = STATE.PLAYING;
  // Guest calls this same function locally too (see guestHandleMessage) to
  // build an identical shadow of the teams/kits/DOM setup from the same
  // homeDef/oppDef/skillKey - only broadcast if THIS call is the host's own,
  // not the guest's local mirror of it.
  if (G.online && G.online.role === 'host') {
    G.online.matchStarted = true;
    G.online.lastBroadcastAt = 0;
    sendOnlineMessage({ type: 'matchStart', homeDef, oppDef, halfLenMin, skillKey, weather: G.weather, isNightMatch: G.isNightMatch });
  }
}

// ============================================================
// AI
// ============================================================
function goalkeeperTarget(p, team) {
  const lineX = team.attackDir === 1 ? 1.5 : PITCH_LEN - 1.5;
  const halfGoal = GOAL_WIDTH / 2 - 0.4;
  const gy = clamp(G.ball.pos.y, PITCH_WID / 2 - halfGoal, PITCH_WID / 2 + halfGoal);
  return { x: lineX, y: gy };
}

function attackTarget(p, team) {
  const shift = p.group === 'FWD' ? 8 : p.group === 'MID' ? 5 : 2;
  const tx = p.home.x + shift * team.attackDir;
  const ty = lerp(p.home.y, G.ball.pos.y, 0.35);
  return { x: tx, y: ty };
}

function defendTarget(p, team) {
  const drop = (p.group === 'FWD' ? 6 : p.group === 'MID' ? 3 : 1) * (PRESS_STYLES[team.pressStyle] || PRESS_STYLES.mid).dropMult;
  const tx = p.home.x - drop * team.attackDir;
  const ty = lerp(p.home.y, G.ball.pos.y, 0.25);
  return { x: tx, y: ty };
}

function updatePressing(dt) {
  const possTeam = G.ball.owner ? G.ball.owner.__team : null;
  for (let t = 0; t < 2; t++) {
    const team = G.teams[t];
    for (const p of outfield(team)) p.pressing = false;
    if (possTeam === t) continue; // team in possession doesn't press
    const pressCount = (PRESS_STYLES[team.pressStyle] || PRESS_STYLES.mid).pressCount;
    const candidates = outfield(team).slice().sort((a, b) => dist(a.pos, G.ball.pos) - dist(b.pos, G.ball.pos));
    for (let i = 0; i < Math.min(pressCount, candidates.length); i++) candidates[i].pressing = true;
  }
}

function aiMovePlayer(p, team, dt) {
  if (p === G.controlled || p === G.controlled2) return; // human-controlled (locally or by the online guest), skip AI movement
  if (p.sentOff) { p.vel = { x: 0, y: 0 }; return; } // stays on the pitch but takes no further part
  const possTeam = G.ball.owner ? G.ball.owner.__team : null;
  let target;
  const now = performance.now() / 1000;
  const isThrowinSupport = p.supportTarget && G.restart && G.restart.kind === 'throwin' &&
    G.ball.owner === G.restart.taker && p.__team === G.restart.taker.__team;
  const isRunning = p.runUntil && now < p.runUntil;
  if (p.isGK) {
    target = goalkeeperTarget(p, team);
  } else if (isThrowinSupport) {
    target = p.supportTarget; // offering a close outlet for the throw-in taker
  } else if (isRunning) {
    target = p.runTarget; // sprinting into space toward the opponent's goal
  } else if (possTeam === p.__team) {
    target = attackTarget(p, team);
  } else if (p.pressing) {
    target = G.ball.pos;
  } else {
    target = defendTarget(p, team);
  }
  // small jitter so players don't all move identically
  const jitter = Math.sin(performance.now() / 500 + p.noiseSeed) * G.skill.noise * 0.15;
  const tgt = { x: target.x, y: clamp(target.y + jitter, 0.5, PITCH_WID - 0.5) };
  const toTarget = sub(tgt, p.pos);
  const d = len(toTarget);
  drainStamina(p, dt, (p.pressing || isRunning) ? 1.4 : (d > 0.15 ? 1.0 : 0.5));
  let speed = G.skill.speed * p.pace;
  if (p.isGK) speed *= GK_SPEED_MULT;
  if (p.pressing) speed *= G.skill.pressBoost;
  // Team strength and difficulty can push pace well above the old fixed
  // range this was tuned against - re-cap normal movement below your own
  // speed so a strong/boosted opponent still can't simply outrun you.
  // A deliberate breakaway run is allowed past that cap - that's the point.
  if (!p.isGK) speed = Math.min(speed, HUMAN_SPEED * 0.97);
  if (isRunning) speed *= 1.2;
  speed *= lerp(0.7, 1.0, p.stamina); // tired legs move slower
  if (d > 0.15) {
    const dir = norm(toTarget);
    approachVelocity(p, { x: dir.x * speed, y: dir.y * speed }, PLAYER_ACCEL, dt);
    p.facing = dir;
  } else {
    approachVelocity(p, { x: 0, y: 0 }, PLAYER_ACCEL, dt);
  }
  p.pos.x += p.vel.x * dt;
  p.pos.y += p.vel.y * dt;
  if (!p.isGK && len(p.vel) > DIRT_SPRINT_SPEED && Math.random() < dt * DIRT_SPRINT_RATE) {
    spawnDirt(p.pos.x, p.pos.y, 1, 0.15);
  }
  if (checkCarrierRanOut(p)) return; // ball just went out - restart already set up
  clampToPitch(p.pos);
}

function aiTackleAttempt(p, dt) {
  if (p === G.controlled || p === G.controlled2) return;
  if (!p.pressing || p.isGK || p.sentOff) return;
  if (!G.ball.owner || G.ball.owner.__team === p.__team) return;
  if (dist(p.pos, G.ball.pos) > TACKLE_RADIUS) return;
  const now = performance.now() / 1000;
  if (now - p.lastTackleTry < TACKLE_RETRY_SEC) return;
  p.lastTackleTry = now;
  if (Math.random() < clamp(G.skill.tackleChance * p.tackling, 0.05, 0.95)) {
    SFX.tackle();
    shakeScreen();
    vibrate(25);
    G.stats.tackles[p.__team]++;
    p.matchTackles++;
    const dispossessed = G.ball.owner;
    loseBallFrom(dispossessed, p.__team);
    maybeInjurePlayer(dispossessed);
    spawnDirt(p.pos.x, p.pos.y, 8, 0.7);
  } else {
    maybeCallFoul(p, { x: G.ball.pos.x, y: G.ball.pos.y });
  }
}

// True once a team is far enough ahead late in a half that a real side would
// start shielding the ball and running the clock down rather than pushing
// for another goal - only relevant in the second half/extra time, since
// there's nothing to protect yet in the first.
function isProtectingLead(teamIdx) {
  const team = G.teams[teamIdx], opp = G.teams[1 - teamIdx];
  if (team.score <= opp.score) return false;
  const lateInHalf = G.elapsedSec > G.halfLengthSec * 0.75;
  return lateInHalf && (G.half === 2 || G.extraTime);
}

function aiPossessionDecision(p, team, dt) {
  if (p === G.controlled || p === G.controlled2) return;
  if (G.ball.owner !== p) return;
  p.decisionTimer -= dt;
  if (p.decisionTimer > 0) return;
  const timeWasting = isProtectingLead(p.__team);
  p.decisionTimer = rand(G.skill.reassessMin, G.skill.reassessMax) * (timeWasting ? 1.7 : 1);
  const goalX = team.attackDir === 1 ? PITCH_LEN : 0;
  const goalY = PITCH_WID / 2;
  const distToGoal = dist(p.pos, { x: goalX, y: goalY });
  const opponents = outfield(G.teams[1 - p.__team]);
  opponents.sort((a, b) => dist(a.pos, p.pos) - dist(b.pos, p.pos));
  const underPressure = opponents.length && dist(opponents[0].pos, p.pos) < 4;

  if (!timeWasting && distToGoal < G.skill.shootRange && Math.random() < 0.8) {
    const power = clamp(0.4 + (G.skill.shootRange - distToGoal) / G.skill.shootRange, 0.4, 1);
    releaseShot(p, team, power);
  } else if (underPressure || Math.random() < (timeWasting ? 0.6 : 0.35)) {
    const power = rand(0.4, 0.9);
    releasePass(p, team, power);
  }
  // otherwise: keep dribbling forward (handled by aiMovePlayer's attackTarget) -
  // or, while shielding a lead, just holding the ball up under no pressure
}

// Sends a player sprinting into space toward the opponent's goal - used both
// by the human's "call a run" button and by the AI's own automatic runs.
function triggerRun(p, team) {
  const targetX = clamp(p.pos.x + team.attackDir * rand(16, 26), 3, PITCH_LEN - 3);
  const targetY = clamp(p.pos.y + rand(-10, 10), 3, PITCH_WID - 3);
  p.runTarget = { x: targetX, y: targetY };
  p.runUntil = performance.now() / 1000 + 2.2;
}

// Every AI attacker/midfielder occasionally makes their own forward run when
// their team has the ball, independent of any button - so the opponent (and
// your own AI teammates) create chances by breaking forward, not just the
// human-controlled player.
function maybeStartRun(p, team, dt) {
  if (p.isGK || p.group === 'DEF' || p === G.controlled || p === G.controlled2 || p.sentOff) return;
  if (p.stamina < 0.4) return; // too gassed to make a speculative sprint
  const now = performance.now() / 1000;
  if (p.runUntil && now < p.runUntil) return; // already on a run
  p.runTimer -= dt;
  if (p.runTimer > 0) return;
  p.runTimer = rand(2, 4);
  const possTeam = G.ball.owner ? G.ball.owner.__team : null;
  if (possTeam !== p.__team || G.ball.owner === p) return;
  if (Math.random() < 0.3) triggerRun(p, team);
}

// Human control: the player in possession calls their most advanced
// teammate to break forward, to try to find them with a through ball.
// forPlayer lets the host resolve this for the online guest's player
// (G.controlled2) too - see hostHandleMessage's 'run' branch - without it,
// this defaults to the local G.controlled exactly as before.
function callTeammateRun(forPlayer) {
  if (G.state !== STATE.PLAYING) return;
  if (!forPlayer && G.online && G.online.role === 'guest') { sendOnlineMessage({ type: 'run' }); return; }
  const p = forPlayer || G.controlled;
  if (!p || G.ball.owner !== p) return;
  const team = G.teams[p.__team];
  const now = performance.now() / 1000;
  const goalX = team.attackDir === 1 ? PITCH_LEN : 0;
  const candidates = team.players.filter(x => x !== p && !x.isGK && !(x.runUntil && now < x.runUntil));
  if (!candidates.length) return;
  candidates.sort((a, b) => Math.abs(goalX - a.pos.x) - Math.abs(goalX - b.pos.x));
  triggerRun(candidates[0], team);
}

// ============================================================
// Ball physics
// ============================================================
function loseBallFrom(prevOwner, newTouchTeam) {
  const knockDir = norm({ x: rand(-1, 1), y: rand(-1, 1) });
  G.ball.owner = null;
  G.ball.vel = { x: knockDir.x * 2.5, y: knockDir.y * 2.5 };
  G.ball.lastTouchTeam = newTouchTeam;
}

// Offside is not called direct from a kickoff, throw-in, corner or goal kick
// (same exemptions as the real laws) - only from open play or a free kick.
const OFFSIDE_EXEMPT_KINDS = ['throwin', 'corner', 'kickoff', 'goalkick'];

function isOffside(receiver, team) {
  const halfway = PITCH_LEN / 2;
  const inOppHalf = team.attackDir === 1 ? receiver.pos.x > halfway : receiver.pos.x < halfway;
  if (!inOppHalf) return false;
  const oppDefenders = outfield(G.teams[1 - receiver.__team]);
  if (!oppDefenders.length) return false;
  const lastDefenderX = team.attackDir === 1
    ? Math.max(...oppDefenders.map(d => d.pos.x))
    : Math.min(...oppDefenders.map(d => d.pos.x));
  const aheadOfDefense = team.attackDir === 1 ? receiver.pos.x > lastDefenderX : receiver.pos.x < lastDefenderX;
  const aheadOfBall = team.attackDir === 1 ? receiver.pos.x > G.ball.pos.x : receiver.pos.x < G.ball.pos.x;
  return aheadOfDefense && aheadOfBall;
}

// Returns true (and awards the free kick) if the pass should be stopped for offside.
function checkOffsideAndCall(target, team, exempt) {
  if (exempt || !target || !isOffside(target, team)) return false;
  SFX.whistle();
  showToast(pick(['🚫 OFFSIDE!', '🚫 Flag Up - Offside', '🚫 Caught Offside']), '#eab308');
  const offsideTeamName = document.getElementById(target.__team === 0 ? 'score-home-name' : 'score-away-name').textContent;
  logMatchEvent(`🚫 Offside - ${offsideTeamName} - ${playerLabel(target)}`);
  const spot = { x: clamp(target.pos.x, 3, PITCH_LEN - 3), y: clamp(target.pos.y, 2, PITCH_WID - 2) };
  startTeamRestart(1 - target.__team, spot, CORNER_EXCLUSION, 'freekick');
  return true;
}

function releasePass(player, team, power) {
  SFX.kick();
  const restartKindAtKick = G.restart ? G.restart.kind : null;
  const offsideExempt = OFFSIDE_EXEMPT_KINDS.includes(restartKindAtKick);
  if (G.restart && G.ball.owner === player) G.restart = null;
  const teammates = team.players.filter(p => p !== player);
  const facing = len(player.facing) > 0.01 ? norm(player.facing) : { x: team.attackDir, y: 0 };

  let cone = teammates.filter(t => {
    const d = norm(sub(t.pos, player.pos));
    return (d.x * facing.x + d.y * facing.y) > 0.26;
  });
  if (cone.length === 0) cone = teammates;
  cone.sort((a, b) => dist(a.pos, player.pos) - dist(b.pos, player.pos));
  const target = cone[0];
  if (checkOffsideAndCall(target, team, offsideExempt)) return;
  const dir = norm(sub(target.pos, player.pos));
  const speed = PASS_MIN_SPEED + power * (PASS_MAX_SPEED - PASS_MIN_SPEED);

  G.ball.owner = null;
  G.ball.pos = { x: player.pos.x + facing.x * 0.4, y: player.pos.y + facing.y * 0.4 };
  G.ball.vel = { x: dir.x * speed, y: dir.y * speed };
  G.ball.lastTouchTeam = player.__team;
  G.ball.lastToucher = player;
  G.ball.kickImmuneFrom = player;
  G.ball.kickImmuneUntil = performance.now() / 1000 + 0.5;
}

// `aim` (-1..1, left post to right post) is only passed for a human-steered
// dead ball (penalty/free kick/practice - see isAimableShotSituation) - every
// other shot (AI takers, open play) keeps the existing random-but-skill-
// weighted targeting by leaving it undefined.
function releaseShot(player, team, power, aim) {
  SFX.kick();
  if (power > 0.7) shakeScreen(); // a real thump of a strike
  const goalX = team.attackDir === 1 ? PITCH_LEN : 0;
  const goalY = PITCH_WID / 2;

  let aimPoint;
  if (aim != null) {
    // The intended spot comes from where they steered the marker, with some
    // wobble based on finishing and how close to the post they're going -
    // safer down the middle is easier to execute than threading it right
    // along the frame, same risk/reward as a real placed penalty.
    const halfGoal = GOAL_WIDTH / 2 - 0.5;
    const intendedY = goalY + clamp(aim, -1, 1) * halfGoal;
    const accuracy = clamp(player.finishing, 0.6, 1.5);
    const wobble = clamp(1.3 / accuracy, 0.5, 2.2) * (0.5 + Math.abs(aim) * 0.5);
    aimPoint = { x: goalX, y: intendedY + rand(-wobble, wobble) };
    G.stats.shots[player.__team]++;
    if (Math.abs(aimPoint.y - goalY) <= GOAL_WIDTH / 2) G.stats.shotsOnTarget[player.__team]++;
  } else {
    const edgeX = team.attackDir === 1 ? PITCH_LEN - BOX_DEPTH : BOX_DEPTH;
    const nearest = { x: edgeX, y: clamp(player.pos.y, goalY - BOX_WIDTH / 2, goalY + BOX_WIDTH / 2) };
    const insideBox = team.attackDir === 1
      ? (player.pos.x >= PITCH_LEN - BOX_DEPTH && Math.abs(player.pos.y - goalY) <= BOX_WIDTH / 2)
      : (player.pos.x <= BOX_DEPTH && Math.abs(player.pos.y - goalY) <= BOX_WIDTH / 2);
    const distBeyond = insideBox ? 0 : dist(player.pos, nearest);
    const tenths = distBeyond / (PITCH_LEN / 10);
    const baseChance = insideBox ? 1 : clamp(1 - 0.3 * tenths, 0, 1);
    const onTargetChance = clamp(baseChance * player.finishing, 0, 1); // a poor finisher can still miss even in the box
    const onTarget = Math.random() < onTargetChance;
    G.stats.shots[player.__team]++;
    if (onTarget) G.stats.shotsOnTarget[player.__team]++;
    if (onTarget) {
      aimPoint = { x: goalX, y: goalY + rand(-1, 1) * (GOAL_WIDTH / 2 - 0.6) };
    } else {
      const side = Math.random() < 0.5 ? -1 : 1;
      aimPoint = { x: goalX, y: clamp(goalY + side * (GOAL_WIDTH / 2 + rand(1, 6)), 0, PITCH_WID) };
    }
  }
  const dir = norm(sub(aimPoint, player.pos));
  const speed = SHOT_MIN_SPEED + power * (SHOT_MAX_SPEED - SHOT_MIN_SPEED);
  G.ball.owner = null;
  G.ball.pos = { x: player.pos.x + dir.x * 0.4, y: player.pos.y + dir.y * 0.4 };
  G.ball.vel = { x: dir.x * speed, y: dir.y * speed };
  G.ball.lastTouchTeam = player.__team;
  G.ball.lastToucher = player;
  G.ball.kickImmuneFrom = player;
  G.ball.kickImmuneUntil = performance.now() / 1000 + 0.5;
}

function updateBall(dt) {
  const b = G.ball;
  if (b.owner) {
    const facing = len(b.owner.facing) > 0.01 ? norm(b.owner.facing) : { x: 1, y: 0 };
    b.pos.x = b.owner.pos.x + facing.x * 0.35;
    b.pos.y = b.owner.pos.y + facing.y * 0.35;
    b.vel = { x: 0, y: 0 };
    b.spin += len(b.owner.vel) * dt * 0.6; // rolls at the carrier's feet as they dribble
    if (checkCarrierRanOut(b.owner)) return; // safety net alongside the check in the movement functions
    if (checkGoalkeeperSmother()) return; // keeper claimed it at your feet
    checkCarriedGoal();
    return;
  }
  // free-flight
  b.pos.x += b.vel.x * dt;
  b.pos.y += b.vel.y * dt;
  const speed = len(b.vel);
  b.spin += speed * dt * 0.6;

  if (!G.goalPending) checkGoalMouth(); // may set G.goalPending = true just now
  if (G.goalPending) {
    settleBallInNet(dt); // hits the back/side of the net and stops there, instead of coasting on through under normal friction
    return;
  }

  // normal pitch friction - skiddier in the rain, see RAIN_FRICTION_MULT
  if (speed > 0.01) {
    const decel = 3.2 * (G.weather === 'rain' ? RAIN_FRICTION_MULT : 1) * dt;
    const newSpeed = Math.max(0, speed - decel);
    const dir = norm(b.vel);
    b.vel = { x: dir.x * newSpeed, y: dir.y * newSpeed };
  } else {
    b.vel = { x: 0, y: 0 };
  }

  if (G.state !== STATE.PLAYING) return;
  checkPickup();
  checkOutOfBounds();
}

// Once a goal's been given, the ball doesn't keep coasting under normal
// pitch friction - it hits the back or side netting and stops there, same
// idea as a real net absorbing the shot rather than the ball sailing through.
function settleBallInNet(dt) {
  const b = G.ball;
  const netMinX = G.goalEndDir === 1 ? PITCH_LEN : -GOAL_DEPTH;
  const netMaxX = G.goalEndDir === 1 ? PITCH_LEN + GOAL_DEPTH : 0;
  if (b.pos.x > netMaxX) { b.pos.x = netMaxX; b.vel.x = 0; }
  if (b.pos.x < netMinX) { b.pos.x = netMinX; b.vel.x = 0; }
  const halfGoal = GOAL_WIDTH / 2 - 0.3;
  const netMinY = PITCH_WID / 2 - halfGoal, netMaxY = PITCH_WID / 2 + halfGoal;
  if (b.pos.y > netMaxY) { b.pos.y = netMaxY; b.vel.y = 0; }
  if (b.pos.y < netMinY) { b.pos.y = netMinY; b.vel.y = 0; }
  const speed = len(b.vel);
  if (speed > 0.01) {
    const decel = 14 * dt; // strong net drag - settles almost immediately instead of bouncing around
    const newSpeed = Math.max(0, speed - decel);
    const dir = norm(b.vel);
    b.vel = { x: dir.x * newSpeed, y: dir.y * newSpeed };
  } else {
    b.vel = { x: 0, y: 0 };
  }
}

function checkPickup() {
  const b = G.ball;
  if (b.owner) return;
  const now = performance.now() / 1000;
  let best = null, bestD = PICKUP_RADIUS;
  for (const team of G.teams) {
    for (const p of team.players) {
      if (p.sentOff) continue;
      if (p === b.kickImmuneFrom && now < b.kickImmuneUntil) continue;
      const d = dist(p.pos, b.pos);
      if (d < bestD) { bestD = d; best = p; }
    }
  }
  if (best) {
    b.owner = best;
    b.lastTouchTeam = best.__team;
    autoAssignControl();
  }
}

// Briefly slows the sim down right as a goal is struck, then hands off to
// the normal celebration - a small "did that really go in?" beat instead of
// snapping straight to the goal banner. Guarded by goalPending so the ball
// resting near the line during that window can't trigger a second goal.
function triggerGoalSlowMo(scoringIdx, endDir) {
  G.goalPending = true;
  G.goalEndDir = endDir;
  G.netRipple = { dir: endDir, y: G.ball.pos.y, t: performance.now() };
  // Captured now, while the ball still knows who last had it - a carried
  // goal has G.ball.owner (the dribbler), a shot has already cleared owner
  // to null so lastToucher (set in releaseShot/releasePass) covers that case.
  G.pendingScorer = G.ball.owner || G.ball.lastToucher || null;
  SFX.netHit();
  G.slowMoFactor = 0.25;
  G.slowMoTimeout = setTimeout(() => {
    G.slowMoTimeout = null;
    G.slowMoFactor = 1;
    G.goalPending = false;
    scoreGoal(scoringIdx);
  }, 700);
}

function checkGoalMouth() {
  const b = G.ball;
  if (G.goalPending) return;
  const halfGoal = GOAL_WIDTH / 2;
  if (b.pos.x >= PITCH_LEN && Math.abs(b.pos.y - PITCH_WID / 2) <= halfGoal) {
    resolveGoalAttempt(1); // ball heading into the goal at x=PITCH_LEN, defended by whoever attacks -1 there
  } else if (b.pos.x <= 0 && Math.abs(b.pos.y - PITCH_WID / 2) <= halfGoal) {
    resolveGoalAttempt(-1);
  }
}

// Goalkeepers never press or tackle (see aiTackleAttempt), so without this a
// dribbler could just walk the ball straight past the keeper and in - this
// gives the keeper a chance to smother the ball at the carrier's feet instead.
function checkGoalkeeperSmother() {
  const b = G.ball;
  if (!b.owner || G.restart) return false;
  const carrier = b.owner;
  const gk = G.teams[1 - carrier.__team].players.find(p => p.isGK);
  if (dist(carrier.pos, gk.pos) > GK_SMOTHER_RADIUS) return false;
  const now = performance.now() / 1000;
  if (now - gk.lastTackleTry < TACKLE_RETRY_SEC) return false;
  gk.lastTackleTry = now;
  if (Math.random() >= clamp(GK_SMOTHER_CHANCE * gk.reflexes, 0.05, 0.95)) return false;
  SFX.catch();
  b.owner = gk;
  b.vel = { x: 0, y: 0 };
  b.pos = { x: gk.pos.x, y: gk.pos.y };
  b.lastTouchTeam = gk.__team;
  autoAssignControl();
  return true;
}

// A player who has dribbled the ball across the line has already beaten the
// keeper physically, so this counts straight away - no save roll needed.
function checkCarriedGoal() {
  const b = G.ball;
  if (G.goalPending) return;
  if (Math.abs(b.pos.y - PITCH_WID / 2) > GOAL_WIDTH / 2) return;
  let endDir = 0;
  if (b.pos.x >= PITCH_LEN) endDir = 1;
  else if (b.pos.x <= 0) endDir = -1;
  if (!endDir) return;
  const attacker = attackingTeamAtGoalEnd(endDir);
  triggerGoalSlowMo(attacker === G.teams[0] ? 0 : 1, endDir);
}

function defendingTeamAtGoalEnd(endDir) {
  return G.teams.find(t => t.attackDir === -endDir);
}
function attackingTeamAtGoalEnd(endDir) {
  return G.teams.find(t => t.attackDir === endDir);
}

function resolveGoalAttempt(endDir) {
  const defender = defendingTeamAtGoalEnd(endDir);
  const attacker = attackingTeamAtGoalEnd(endDir);
  const gk = defender.players.find(p => p.isGK);
  const saved = Math.random() < clamp(GK_SAVE_CHANCE * gk.reflexes, 0.05, 0.95);
  if (saved) {
    SFX.catch();
    G.ball.owner = gk;
    G.ball.vel = { x: 0, y: 0 };
    G.ball.pos = { x: gk.pos.x, y: gk.pos.y };
    G.ball.lastTouchTeam = gk.__team;
    autoAssignControl();
  } else {
    triggerGoalSlowMo(attacker === G.teams[0] ? 0 : 1, endDir);
  }
}

// Fires one burst of confetti from both bottom corners of the screen.
function confettiBurst(color, perSide) {
  const layer = document.getElementById('confetti-layer');
  // Built around the scoring team's own kit colour, white as the accent.
  const colors = [color, color, '#ffffff'];
  [1, -1].forEach((dirSign) => {
    for (let i = 0; i < perSide; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      piece.style.background = colors[Math.floor(Math.random() * colors.length)];
      piece.style.left = dirSign === 1 ? '0px' : 'calc(100% - 8px)';
      piece.style.bottom = '0px';
      layer.appendChild(piece);

      const angleDeg = rand(20, 80); // degrees above horizontal
      const rad = angleDeg * Math.PI / 180;
      const flightDist = rand(220, 520);
      const peakX = Math.cos(rad) * flightDist * dirSign;
      const peakY = -Math.sin(rad) * flightDist;
      const fallX = peakX * 1.35;
      const fallY = peakY * -0.25 + rand(180, 340);
      const rot = rand(240, 720) * (Math.random() < 0.5 ? 1 : -1);
      const duration = rand(2600, 3600);

      const anim = piece.animate([
        { transform: 'translate(0px,0px) rotate(0deg)', opacity: 1 },
        { transform: `translate(${peakX}px,${peakY}px) rotate(${rot * 0.5}deg)`, opacity: 1, offset: 0.35 },
        { transform: `translate(${fallX}px,${fallY}px) rotate(${rot}deg)`, opacity: 0 },
      ], { duration, easing: 'cubic-bezier(.15,.6,.4,1)' });
      anim.onfinish = () => piece.remove();
    }
  });
}

// Keeps confetti falling across the whole (now longer) goal celebration
// instead of one burst fizzling out partway through it.
function launchConfetti(color) {
  if (G.reducedMotion) return;
  confettiBurst(color, 35);
  G.confettiTimeouts.push(setTimeout(() => confettiBurst(color, 22), 900));
  G.confettiTimeouts.push(setTimeout(() => confettiBurst(color, 22), 1900));
  G.confettiTimeouts.push(setTimeout(() => confettiBurst(color, 18), 2900));
}

// ---------- Goal replay clip ----------
// A short rolling recording of recent positions, played back in slow motion
// during the goal celebration - purely local on each side (host records its
// own live sim, the guest records whatever it's already rendering via
// interpolateShadowState), so no network message is needed to sync it.
const REPLAY_BUFFER_MAX = 90; // ~1.5s of build-up at ~60fps
function snapshotPositions() {
  return {
    p: G.teams.map(team => team.players.map(p => ({ x: p.pos.x, y: p.pos.y, vx: p.vel.x, vy: p.vel.y }))),
    b: { x: G.ball.pos.x, y: G.ball.pos.y, vx: G.ball.vel.x, vy: G.ball.vel.y, spin: G.ball.spin },
  };
}
function applyPositions(snap) {
  G.teams.forEach((team, ti) => team.players.forEach((p, pi) => {
    const f = snap.p[ti] && snap.p[ti][pi];
    if (!f) return;
    p.pos.x = f.x; p.pos.y = f.y; p.vel.x = f.vx; p.vel.y = f.vy;
  }));
  G.ball.pos.x = snap.b.x; G.ball.pos.y = snap.b.y; G.ball.vel.x = snap.b.vx; G.ball.vel.y = snap.b.vy; G.ball.spin = snap.b.spin;
}
function recordReplayFrame() {
  if (G.replay.active || !G.teams[0] || !G.teams[1]) return;
  G.replayBuffer.push(snapshotPositions());
  if (G.replayBuffer.length > REPLAY_BUFFER_MAX) G.replayBuffer.shift();
}
// Returns true if a clip actually started (onDone will be called once it
// finishes); false if there wasn't enough build-up recorded to bother with
// (e.g. a goal seconds after kickoff) - caller should run onDone itself then.
function startGoalReplay(onDone) {
  if (G.replayBuffer.length < 15) return false;
  G.replay.restoreState = snapshotPositions();
  G.replay.frames = G.replayBuffer.slice();
  G.replay.idx = 0;
  G.replay.everyOther = false;
  G.replay.active = true;
  G.replay.onDone = onDone || null;
  document.getElementById('replay-badge').classList.remove('hidden');
  return true;
}
// Advances one buffered frame every *other* rAF tick - a simple half-speed
// slow-mo with no interpolation needed between recorded frames.
function stepGoalReplay() {
  if (!G.replay.active) return;
  G.replay.everyOther = !G.replay.everyOther;
  if (G.replay.everyOther) return;
  applyPositions(G.replay.frames[G.replay.idx]);
  G.replay.idx++;
  if (G.replay.idx >= G.replay.frames.length) endGoalReplay();
}
function endGoalReplay() {
  G.replay.active = false;
  document.getElementById('replay-badge').classList.add('hidden');
  if (G.replay.restoreState) applyPositions(G.replay.restoreState);
  G.replay.restoreState = null;
  G.replay.frames = null;
  const onDone = G.replay.onDone;
  G.replay.onDone = null;
  if (onDone) onDone();
}

function scoreGoal(scoringIdx) {
  G.stoppageEvents++;
  G.teams[scoringIdx].score++;
  document.getElementById('score-home').textContent = G.teams[0].score;
  document.getElementById('score-away').textContent = G.teams[1].score;
  SFX.goal();
  vibrate([80, 40, 80]);
  G.confettiTimeouts.forEach(clearTimeout);
  G.confettiTimeouts = [];
  launchConfetti(G.teams[scoringIdx].shirt);
  const teamName = document.getElementById(scoringIdx === 0 ? 'score-home-name' : 'score-away-name').textContent;
  const scorer = G.pendingScorer;
  if (scorer) scorer.goals++;
  const scorerLabel = scorer ? playerLabel(scorer) : teamName;
  logMatchEvent(`⚽ ${teamName} ${G.teams[0].score}-${G.teams[1].score} (${scorerLabel})`);
  G.pendingScorer = null;
  G.state = STATE.GOAL;
  // The banner is a full-screen dark overlay (see .overlay in style.css),
  // which would hide the replay clip entirely - so if a clip actually starts,
  // hold the banner back until the clip finishes rather than showing both at once.
  const revealGoalBanner = () => {
    document.getElementById('goal-banner-text').textContent = `GOAL! ${scorerLabel}`;
    document.getElementById('goal-banner').style.setProperty('--team-color', G.teams[scoringIdx].shirt);
    document.getElementById('goal-banner').classList.remove('hidden');
  };
  if (!startGoalReplay(revealGoalBanner)) revealGoalBanner();
  if (G.online && G.online.role === 'host') {
    sendOnlineMessage({ type: 'stateChange', state: STATE.GOAL, extra: { text: `GOAL! ${scorerLabel}`, teamColor: G.teams[scoringIdx].shirt } });
  }
  G.goalTimeout = setTimeout(() => {
    G.goalTimeout = null;
    if (G.replay.active) endGoalReplay(); // safety net if a slow frame rate left the clip still playing
    document.getElementById('goal-banner').classList.add('hidden');
    doKickoff(1 - scoringIdx);
    G.state = STATE.PLAYING;
    if (G.online && G.online.role === 'host') sendOnlineMessage({ type: 'stateChange', state: STATE.PLAYING });
  }, GOAL_CELEBRATION_SEC);
}

const THROWIN_EXCLUSION = 6;   // pushed back further than the real 2m law, for breathing room
const CORNER_EXCLUSION = CENTER_CIRCLE_R; // real law: same 9.15m as a kickoff
const GOALKICK_EXCLUSION = BOX_DEPTH;     // opponents must stay outside the box

function checkOutOfBounds() {
  const b = G.ball;
  if (b.owner) return;
  if (b.pos.y < 0 || b.pos.y > PITCH_WID) {
    // throw-in, taken by whoever on the restarting team is nearest the spot
    SFX.whistle();
    const restartTeamIdx = 1 - b.lastTouchTeam;
    const spot = { x: clamp(b.pos.x, 0.5, PITCH_LEN - 0.5), y: clamp(b.pos.y, 0, PITCH_WID) };
    startTeamRestart(restartTeamIdx, spot, THROWIN_EXCLUSION, 'throwin');
    return;
  }
  if (b.pos.x < 0 || b.pos.x > PITCH_LEN) {
    const endDir = b.pos.x > PITCH_LEN ? 1 : -1;
    const defender = defendingTeamAtGoalEnd(endDir);
    const attacker = attackingTeamAtGoalEnd(endDir);
    if (b.lastTouchTeam === (defender === G.teams[0] ? 0 : 1)) {
      // corner: ball went out off the defending team, restart from the corner arc
      SFX.whistle();
      const cornerX = endDir === 1 ? PITCH_LEN : 0;
      const cornerY = b.pos.y > PITCH_WID / 2 ? PITCH_WID : 0;
      const cornerTeamIdx = attacker === G.teams[0] ? 0 : 1;
      G.stats.corners[cornerTeamIdx]++;
      startTeamRestart(cornerTeamIdx, { x: cornerX, y: cornerY }, CORNER_EXCLUSION, 'corner');
    } else {
      // goal kick: ball went out off the attacking team
      SFX.whistle();
      const gkX = endDir === 1 ? PITCH_LEN - SIX_DEPTH : SIX_DEPTH;
      const gk = defender.players.find(p => p.isGK);
      beginRestart(gk, { x: gkX, y: PITCH_WID / 2 }, GOALKICK_EXCLUSION, 'goalkick');
    }
  }
}

// The pitch-edge clamp (clampToPitch) stops every player's BODY right at the
// line - but the ball itself is drawn 0.35m ahead of them, in their facing
// direction. That meant a carrier could stand clamped just inside the edge,
// facing outward, with the ball already visibly poking out of bounds every
// frame, and it would never be ruled out - the old version only checked the
// player's own body position, which the clamp was always protecting. This
// checks where the BALL actually is (before this frame's clamp), which is
// what real football rules on. Returns true if a restart was triggered
// (caller should skip clamping).
function checkCarrierRanOut(p) {
  if (G.ball.owner !== p) return false;
  const facing = len(p.facing) > 0.01 ? norm(p.facing) : { x: 1, y: 0 };
  const ballX = p.pos.x + facing.x * 0.35;
  const ballY = p.pos.y + facing.y * 0.35;
  const withinGoalY = Math.abs(ballY - PITCH_WID / 2) <= GOAL_WIDTH / 2;
  const outSide = ballY < 0 || ballY > PITCH_WID;
  const outEnd = !withinGoalY && (ballX < 0 || ballX > PITCH_LEN);
  if (!outSide && !outEnd) return false;
  const team = p.__team;
  if (outSide) {
    SFX.whistle();
    const spot = { x: clamp(ballX, 0.5, PITCH_LEN - 0.5), y: clamp(ballY, 0, PITCH_WID) };
    startTeamRestart(1 - team, spot, THROWIN_EXCLUSION, 'throwin');
  } else {
    const endDir = ballX > PITCH_LEN ? 1 : -1;
    const defender = defendingTeamAtGoalEnd(endDir);
    const attacker = attackingTeamAtGoalEnd(endDir);
    if ((defender === G.teams[0] ? 0 : 1) === team) {
      // defender carried it out over their own byline -> corner
      SFX.whistle();
      const cornerX = endDir === 1 ? PITCH_LEN : 0;
      const cornerY = ballY > PITCH_WID / 2 ? PITCH_WID : 0;
      const cornerTeamIdx = attacker === G.teams[0] ? 0 : 1;
      G.stats.corners[cornerTeamIdx]++;
      startTeamRestart(cornerTeamIdx, { x: cornerX, y: cornerY }, CORNER_EXCLUSION, 'corner');
    } else {
      // attacker carried it out over the opponent's byline -> goal kick
      SFX.whistle();
      const gkX = endDir === 1 ? PITCH_LEN - SIX_DEPTH : SIX_DEPTH;
      const gk = defender.players.find(pl => pl.isGK);
      beginRestart(gk, { x: gkX, y: PITCH_WID / 2 }, GOALKICK_EXCLUSION, 'goalkick');
    }
  }
  return true;
}

// ============================================================
// Human input
// ============================================================
function handleHumanMovement(dt) {
  if (!G.controlled) return;
  // While charging a steerable dead ball, left/right input aims instead of
  // moving - the taker stays planted (same as a real penalty run-up not
  // wandering sideways) while you pick your spot; see releaseShot's `aim` param.
  if (G.ball.owner === G.controlled && G.charge.shoot && isAimableShotSituation()) {
    let steer = G.joystick.x;
    if (G.keysDown[KEYS.left]) steer -= 1;
    if (G.keysDown[KEYS.right]) steer += 1;
    G.shotAim = clamp(G.shotAim + steer * dt * 1.2, -1, 1);
    G.controlled.vel = { x: 0, y: 0 };
    return;
  }
  // Locked at the restart/practice spot until you release it - a real
  // penalty/free-kick taker doesn't wander off their run-up either.
  if (G.ball.owner === G.controlled && (G.restart || G.state === STATE.PRACTICE)) return;
  let mx = 0, my = 0;
  if (G.keysDown[KEYS.up]) my -= 1;
  if (G.keysDown[KEYS.down]) my += 1;
  if (G.keysDown[KEYS.left]) mx -= 1;
  if (G.keysDown[KEYS.right]) mx += 1;
  mx += G.joystick.x;
  my += G.joystick.y;
  const p = G.controlled;
  // the joystick is analog - a light push moves slower, a full push at the edge is full speed
  const pushAmount = clamp(Math.hypot(mx, my), 0, 1);
  drainStamina(p, dt, pushAmount > 0.6 ? 1.4 : pushAmount > 0.1 ? 1.0 : 0.5);
  if (pushAmount > 0.05) {
    const dir = norm({ x: mx, y: my });
    const speed = HUMAN_SPEED * p.pace * pushAmount * lerp(0.7, 1.0, p.stamina);
    approachVelocity(p, { x: dir.x * speed, y: dir.y * speed }, PLAYER_ACCEL, dt);
    p.facing = dir;
  } else {
    approachVelocity(p, { x: 0, y: 0 }, PLAYER_ACCEL, dt);
  }
  p.pos.x += p.vel.x * dt;
  p.pos.y += p.vel.y * dt;
  if (!p.isGK && len(p.vel) > DIRT_SPRINT_SPEED && Math.random() < dt * DIRT_SPRINT_RATE) {
    spawnDirt(p.pos.x, p.pos.y, 1, 0.15);
  }
  if (checkCarrierRanOut(p)) return; // ball just went out - restart already set up
  clampToPitch(p.pos);
}

function tryHumanTackle() {
  if (G.state !== STATE.PLAYING) return;
  if (G.online && G.online.role === 'guest') { sendOnlineMessage({ type: 'tackle' }); return; }
  const b = G.ball;
  if (!b.owner || b.owner.__team === 0) return;
  if (dist(G.controlled.pos, b.pos) > TACKLE_RADIUS) return;
  if (Math.random() < clamp(HUMAN_TACKLE_CHANCE * G.controlled.tackling, 0.05, 0.95)) {
    SFX.tackle();
    shakeScreen();
    vibrate(25);
    G.stats.tackles[0]++;
    const tackler = G.controlled;
    tackler.matchTackles++;
    const dispossessed = b.owner;
    b.owner = tackler;
    b.vel = { x: 0, y: 0 };
    b.lastTouchTeam = 0;
    b.kickImmuneFrom = null;
    autoAssignControl();
    maybeInjurePlayer(dispossessed);
    spawnDirt(tackler.pos.x, tackler.pos.y, 8, 0.7);
  } else {
    maybeCallFoul(G.controlled, { x: b.pos.x, y: b.pos.y });
  }
}

// Host-only mirror of tryHumanTackle for the online guest's player
// (G.controlled2/team 1) - called from hostHandleMessage on a 'tackle' message.
function tryRemoteTackle() {
  if (G.state !== STATE.PLAYING) return;
  const p = G.controlled2;
  const b = G.ball;
  if (!p || !b.owner || b.owner.__team === 1) return;
  if (dist(p.pos, b.pos) > TACKLE_RADIUS) return;
  if (Math.random() < clamp(HUMAN_TACKLE_CHANCE * p.tackling, 0.05, 0.95)) {
    SFX.tackle();
    shakeScreen();
    vibrate(25);
    G.stats.tackles[1]++;
    p.matchTackles++;
    const dispossessed = b.owner;
    b.owner = p;
    b.vel = { x: 0, y: 0 };
    b.lastTouchTeam = 1;
    b.kickImmuneFrom = null;
    autoAssignControl();
    maybeInjurePlayer(dispossessed);
    spawnDirt(p.pos.x, p.pos.y, 8, 0.7);
  } else {
    maybeCallFoul(p, { x: b.pos.x, y: b.pos.y });
  }
}

function trySwitchPlayer() {
  if (G.state !== STATE.PLAYING) return;
  if (G.online && G.online.role === 'guest') { sendOnlineMessage({ type: 'switch' }); return; }
  const b = G.ball;
  if (b.owner && b.owner.__team === 0) return; // only allowed when not in possession
  const mine = outfield(G.teams[0]).slice().sort((a, b2) => dist(a.pos, b.pos) - dist(b2.pos, b.pos));
  if (mine.length) G.controlled = mine[0];
}

// Host-only mirror of trySwitchPlayer for the online guest's player.
function tryRemoteSwitchPlayer() {
  if (G.state !== STATE.PLAYING) return;
  const b = G.ball;
  if (b.owner && b.owner.__team === 1) return;
  const mine = outfield(G.teams[1]).slice().sort((a, b2) => dist(a.pos, b.pos) - dist(b2.pos, b.pos));
  if (mine.length) G.controlled2 = mine[0];
}

function onChargeRelease(kind) {
  const startKey = kind === 'pass' ? 'passStart' : 'shootStart';
  const held = clamp((performance.now() - G.charge[startKey]) / 1000, 0, 2);
  const power = held / 2;
  G.charge[kind] = false;
  // The guest computes its own power locally (using its own clock/charge
  // timers, same math as above) and, for a steerable dead ball, its own
  // G.shotAim too (see guestSteerAim) - sending the final numbers directly
  // means the host doesn't need to guess or re-derive anything.
  if (G.online && G.online.role === 'guest') {
    if (G.state !== STATE.PLAYING) return;
    const aim = (kind === 'shoot' && isAimableShotSituation(G.controlled)) ? G.shotAim : undefined;
    sendOnlineMessage({ type: 'chargeRelease', kind, power, aim });
    return;
  }
  if (G.state === STATE.PRACTICE) {
    // practice is shoot-only - there's no one to pass to, everyone else is banished off-pitch
    if (kind !== 'shoot') return;
    const p = G.controlled;
    if (!p || G.ball.owner !== p) return;
    decidePracticeGKDive(G.shotAim);
    releaseShot(p, G.teams[0], power, G.shotAim);
    return;
  }
  if (G.state !== STATE.PLAYING) return;
  const p = G.controlled;
  if (!p || G.ball.owner !== p) return;
  const restartMustPass = G.restart && G.restart.kind !== 'penalty' && G.restart.kind !== 'freekick';
  if (kind === 'shoot' && restartMustPass) return; // most restarts must be released as a pass; penalties/free kicks can be shot
  if (kind === 'pass') releasePass(p, G.teams[0], power);
  else releaseShot(p, G.teams[0], power, isAimableShotSituation() ? G.shotAim : null);
}

// Host-only mirror of onChargeRelease for the online guest's player - power
// (and aim, for a steerable dead ball) are whatever the guest already
// computed and sent (see onChargeRelease's guest branch), so this just
// applies them directly; releaseShot already treats aim == null as "not
// aimable, auto-target" with no further change needed.
function onRemoteChargeRelease(kind, power, aim) {
  if (G.state !== STATE.PLAYING) return;
  const p = G.controlled2;
  if (!p || G.ball.owner !== p) return;
  const restartMustPass = G.restart && G.restart.kind !== 'penalty' && G.restart.kind !== 'freekick';
  if (kind === 'shoot' && restartMustPass) return;
  if (kind === 'pass') releasePass(p, G.teams[1], power);
  else releaseShot(p, G.teams[1], power, aim);
}

// Host-only: mirrors the movement half of handleHumanMovement, but reads
// G.remoteInput (fed by the guest's 'move' messages) instead of the local
// joystick/keys, and drives G.controlled2 (team 1) instead of G.controlled.
function applyGuestMoveInput(dt) {
  const p = G.controlled2;
  if (!p) return;
  // Locked at the restart spot until the guest releases it - same idea as
  // handleHumanMovement's equivalent check, just without the aim-steering
  // half (see onChargeRelease's guest branch for why).
  if (G.ball.owner === p && G.restart) return;
  const mv = G.remoteInput.move;
  const pushAmount = clamp(Math.hypot(mv.x, mv.y), 0, 1);
  drainStamina(p, dt, pushAmount > 0.6 ? 1.4 : pushAmount > 0.1 ? 1.0 : 0.5);
  if (pushAmount > 0.05) {
    const dir = norm({ x: mv.x, y: mv.y });
    const speed = HUMAN_SPEED * p.pace * pushAmount * lerp(0.7, 1.0, p.stamina);
    approachVelocity(p, { x: dir.x * speed, y: dir.y * speed }, PLAYER_ACCEL, dt);
    p.facing = dir;
  } else {
    approachVelocity(p, { x: 0, y: 0 }, PLAYER_ACCEL, dt);
  }
  p.pos.x += p.vel.x * dt;
  p.pos.y += p.vel.y * dt;
  if (!p.isGK && len(p.vel) > DIRT_SPRINT_SPEED && Math.random() < dt * DIRT_SPRINT_RATE) {
    spawnDirt(p.pos.x, p.pos.y, 1, 0.15);
  }
  if (checkCarrierRanOut(p)) return;
  clampToPitch(p.pos);
}

// ============================================================
// Timer / halftime / fulltime
// ============================================================
function enterHalftime() {
  G.state = STATE.HALFTIME;
  document.getElementById('half-label').textContent = 'Half Time';
  document.getElementById('halftime-overlay').classList.remove('hidden');
  let remaining = 30;
  document.getElementById('halftime-timer').textContent = remaining;
  G.halftimeInterval = setInterval(() => {
    remaining--;
    document.getElementById('halftime-timer').textContent = Math.max(remaining, 0);
    if (remaining <= 0) endHalftime();
  }, 1000);
  // enterHalftime only ever runs on the host (called from updateClock, which
  // the guest never runs) - tell the guest to show its own halftime overlay.
  if (G.online && G.online.role === 'host') sendOnlineMessage({ type: 'stateChange', state: STATE.HALFTIME });
}

// A breather for everyone still on the pitch - not a full reset, fatigue
// still carries into the next period, same idea as a real half-time break.
function recoverStamina(amount) {
  G.teams.forEach(team => team.players.forEach(p => { p.stamina = clamp(p.stamina + amount, 0.2, 1); }));
}

function endHalftime() {
  // Same idea as togglePause's guest guard - a guest clicking "Continue"
  // just asks the host to end halftime instead of touching its own shadow
  // state directly (which the real match on the host would know nothing about).
  if (G.online && G.online.role === 'guest') { sendOnlineMessage({ type: 'endHalftimeRequest' }); return; }
  if (G.halftimeInterval) { clearInterval(G.halftimeInterval); G.halftimeInterval = null; }
  document.getElementById('halftime-overlay').classList.add('hidden');
  recoverStamina(0.25);
  aiAutoSub(G.teams[1]);
  G.half = 2;
  G.elapsedSec = 0;
  G.displayedSec = -1;
  G.addedTimeSec = 0;
  G.addedTimeAnnounced = false;
  G.stoppageEvents = 0;
  G.teams[0].attackDir *= -1;
  G.teams[1].attackDir *= -1;
  document.getElementById('half-label').textContent = '2nd Half';
  doKickoff(1); // team that didn't kick off half 1 kicks off half 2
  G.state = STATE.PLAYING;
  if (G.online && G.online.role === 'host') sendOnlineMessage({ type: 'stateChange', state: STATE.PLAYING });
}

// Lifetime progress, kept across sessions (your team's results only).
const LIFETIME_KEY = 'zacFootballLifetime';
const GOAL_MILESTONES = [1, 10, 25, 50, 100];
const WIN_MILESTONES = [1, 5, 10, 25];
function loadLifetime() {
  try {
    return Object.assign({ goals: 0, wins: 0, matches: 0, cupsWon: 0, uclWon: 0, uelWon: 0 }, JSON.parse(localStorage.getItem(LIFETIME_KEY)));
  } catch (e) {
    return { goals: 0, wins: 0, matches: 0, cupsWon: 0, uclWon: 0, uelWon: 0 };
  }
}
function saveLifetime(lt) {
  try { localStorage.setItem(LIFETIME_KEY, JSON.stringify(lt)); } catch (e) { /* localStorage unavailable - lifetime tracking just won't persist */ }
}

// The Settings/Stats corner buttons' screen - just reads back what
// buildFulltimeReport/recordCupResult have already been persisting all along.
function renderStatsScreen() {
  const lt = loadLifetime();
  const winPct = lt.matches > 0 ? Math.round((lt.wins / lt.matches) * 100) : 0;
  const tile = (value, label) => `<div class="stat-tile"><span class="stat-tile-value">${value}</span><span class="stat-tile-label">${label}</span></div>`;
  document.getElementById('stats-grid').innerHTML =
    tile(lt.matches, 'Matches Played') +
    tile(lt.wins, 'Wins') +
    tile(lt.goals, 'Goals Scored') +
    tile(winPct + '%', 'Win Rate') +
    tile(lt.cupsWon, 'Cups Won') +
    tile(lt.uclWon || 0, 'Champions Leagues') +
    tile(lt.uelWon || 0, 'Europa Leagues');
}

// Builds the stats table and achievement list shown on the full-time screen.
// shootoutResult is only set for a cup tie that was drawn and went to
// penalties - a shootout win still counts as a lifetime win even though the
// normal-time score itself was level.
// Picked from every player who appeared this match (starters + subs brought
// on, see G.allMatchPlayers) by a simple weighted score - goals count far
// more than tackles, same rough priority a real MOTM vote would have. Left
// unset if literally nobody did anything, rather than crowning someone for
// a scoreless, tackle-free stalemate.
function computeManOfTheMatch() {
  let best = null, bestScore = 0;
  for (const p of G.allMatchPlayers) {
    const score = p.goals * 4 + p.matchTackles;
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return best;
}

function buildFulltimeReport(shootoutResult) {
  const s = G.stats;
  const homeScore = G.teams[0].score, awayScore = G.teams[1].score;
  const homeName = document.getElementById('score-home-name').textContent;
  const awayName = document.getElementById('score-away-name').textContent;
  const totalPoss = s.possession[0] + s.possession[1];
  const possPct = [0, 1].map(i => totalPoss > 0 ? Math.round((s.possession[i] / totalPoss) * 100) : 50);

  const rows = [
    ['Shots', s.shots[0], s.shots[1]],
    ['Shots on Target', s.shotsOnTarget[0], s.shotsOnTarget[1]],
    ['Possession', possPct[0] + '%', possPct[1] + '%'],
    ['Tackles Won', s.tackles[0], s.tackles[1]],
    ['Corners', s.corners[0], s.corners[1]],
    ['Fouls', s.fouls[0], s.fouls[1]],
  ];
  document.getElementById('fulltime-stats').innerHTML =
    rows.map(([label, h, a]) => `<tr><td>${h}</td><td>${label}</td><td>${a}</td></tr>`).join('');

  const achievements = [];
  if (homeScore >= 3) achievements.push(`Hat-trick performance: ${homeName}`);
  if (awayScore >= 3) achievements.push(`Hat-trick performance: ${awayName}`);
  if (homeScore > 0 && awayScore === 0) achievements.push(`Clean sheet: ${homeName}`);
  if (awayScore > 0 && homeScore === 0) achievements.push(`Clean sheet: ${awayName}`);

  const lifetime = loadLifetime();
  const before = Object.assign({}, lifetime);
  lifetime.matches++;
  lifetime.goals += homeScore;
  const wonOnPens = shootoutResult && shootoutResult.homePens > shootoutResult.awayPens;
  if (homeScore > awayScore || wonOnPens) lifetime.wins++;
  saveLifetime(lifetime);
  GOAL_MILESTONES.forEach(m => { if (before.goals < m && lifetime.goals >= m) achievements.push(`Milestone: ${m} lifetime goals scored`); });
  WIN_MILESTONES.forEach(m => { if (before.wins < m && lifetime.wins >= m) achievements.push(`Milestone: ${m} lifetime match wins`); });

  document.getElementById('fulltime-achievements').innerHTML = achievements.map(a => `<div>${a}</div>`).join('');

  const motm = computeManOfTheMatch();
  const motmEl = document.getElementById('fulltime-motm');
  if (motm) {
    const teamName = motm.__team === 0 ? homeName : awayName;
    motmEl.textContent = `⭐ Man of the Match: ${playerLabel(motm)} (${teamName}) — ${motm.goals} goal${motm.goals === 1 ? '' : 's'}, ${motm.matchTackles} tackle${motm.matchTackles === 1 ? '' : 's'} won`;
    motmEl.classList.remove('hidden');
  } else {
    motmEl.classList.add('hidden');
  }
}

// A drawn cup tie can't just end level - it goes to penalties first, and only
// once that's resolved does the full-time screen itself appear (see
// finalizeFulltime, which the shootout calls when it concludes).
// A drawn cup tie goes to extra time first, and only if it's STILL level
// after that does it go to penalties - matches modern knockout football
// rules (no golden goal, extra time is played out in full either way).
function startExtraTime() {
  recoverStamina(0.15);
  G.extraTime = true;
  G.etHalf = 1;
  G.halfLengthSec = Math.max(30, Math.round(G.halfLengthSec / 3)); // proportionally shorter than a normal half
  G.elapsedSec = 0;
  G.displayedSec = -1;
  G.addedTimeSec = 0;
  G.addedTimeAnnounced = false;
  G.stoppageEvents = 0;
  document.getElementById('half-label').textContent = 'Extra Time 1';
  doKickoff(0);
  G.state = STATE.PLAYING;
}

function startExtraTimeSecondHalf() {
  G.etHalf = 2;
  G.elapsedSec = 0;
  G.displayedSec = -1;
  G.addedTimeSec = 0;
  G.addedTimeAnnounced = false;
  G.stoppageEvents = 0;
  G.teams[0].attackDir *= -1;
  G.teams[1].attackDir *= -1;
  document.getElementById('half-label').textContent = 'Extra Time 2';
  doKickoff(1);
  G.state = STATE.PLAYING;
}

function enterFulltime() {
  if (CUP && G.teams[0].score === G.teams[1].score) {
    if (!G.extraTime) {
      startExtraTime();
      return;
    }
    G.state = STATE.SHOOTOUT;
    document.getElementById('half-label').textContent = 'Penalties';
    startShootout();
    return;
  }
  finalizeFulltime(null);
}

function finalizeFulltime(shootoutResult) {
  G.state = STATE.FULLTIME;
  SFX.stopCrowdAmbience();
  document.getElementById('half-label').textContent = 'Full Time';
  let scoreText = `${document.getElementById('score-home-name').textContent} ${G.teams[0].score} - ${G.teams[1].score} ${document.getElementById('score-away-name').textContent}`;
  if (shootoutResult) scoreText += ` (pens ${shootoutResult.homePens}-${shootoutResult.awayPens})`;
  document.getElementById('fulltime-score').textContent = scoreText;
  buildFulltimeReport(shootoutResult);
  document.getElementById('fulltime-overlay').classList.remove('hidden');
  const inSeason = !!SEASON, inCup = !!CUP, inCareer = !!CAREER;
  // Rematch just restarts a match locally with no way to re-sync the guest -
  // online matches (always quick-match only, never Season/Cup/Career) only
  // ever get here through the plain else branch below anyway, but hide it
  // explicitly regardless of role so clicking it can't strand the guest.
  document.getElementById('btn-rematch').classList.toggle('hidden', inSeason || inCup || inCareer || !!G.online);
  document.getElementById('btn-continue-season').classList.toggle('hidden', !inSeason);
  document.getElementById('btn-continue-cup').classList.toggle('hidden', !inCup);
  document.getElementById('btn-continue-career').classList.toggle('hidden', !inCareer);
  if (inSeason) {
    recordSeasonResult(); // no auto-timeout here - a season result needs an explicit look, not a silent bounce to the menu
  } else if (inCup) {
    recordCupResult(shootoutResult); // same idea - a cup result needs an explicit look
  } else if (inCareer) {
    recordCareerResult(); // same idea - a career result needs an explicit look
  } else {
    G.fulltimeTimeout = setTimeout(() => goToMainMenu(), 12000);
  }
  // Ship the already-rendered DOM back verbatim rather than re-deriving it -
  // the guest's shadow has no G.stats/lifetime data of its own to compute an
  // equivalent report from, and this guarantees an exact match regardless.
  if (G.online && G.online.role === 'host') {
    sendOnlineMessage({
      type: 'stateChange', state: STATE.FULLTIME,
      extra: {
        scoreText,
        statsHtml: document.getElementById('fulltime-stats').innerHTML,
        achievementsHtml: document.getElementById('fulltime-achievements').innerHTML,
        motmText: document.getElementById('fulltime-motm').textContent,
        motmVisible: !document.getElementById('fulltime-motm').classList.contains('hidden'),
      },
    });
  }
}

// Referee's added time - scaled off the half length itself (since half
// length here is a pacing setting, not a literal 45 minutes) and off how
// many stoppages (fouls/goals/subs) happened this half, same idea as real
// stoppage time being an estimate of time lost to those interruptions.
function computeAddedTime() {
  const base = G.halfLengthSec * 0.05;
  const perEvent = G.halfLengthSec * 0.045;
  return Math.round(clamp(base + G.stoppageEvents * perEvent, 3, G.halfLengthSec * 0.4));
}

// The clock counts down from the half length to 0, then - rather than
// ending the half immediately - keeps counting down through a separately
// computed added-time allowance (shown with a "+" prefix) before actually
// ending the half. elapsedSec tracks time within the CURRENT half only
// (reset in endHalftime), not cumulative match time.
function updateClock(dt) {
  G.elapsedSec += dt;
  if (!G.addedTimeAnnounced && G.elapsedSec >= G.halfLengthSec) {
    G.addedTimeAnnounced = true;
    G.addedTimeSec = computeAddedTime();
    const mm = Math.floor(G.addedTimeSec / 60), ss = Math.round(G.addedTimeSec % 60);
    showToast(`+${mm > 0 ? mm + ':' + String(ss).padStart(2, '0') : ss} added`, '#93c5fd');
  }
  const totalSec = G.halfLengthSec + G.addedTimeSec;
  const remaining = Math.max(0, totalSec - G.elapsedSec);
  const shown = Math.ceil(remaining);
  if (shown !== G.displayedSec) {
    G.displayedSec = shown;
    const inStoppage = G.elapsedSec >= G.halfLengthSec;
    const mm = String(Math.floor(shown / 60)).padStart(2, '0');
    const ss = String(shown % 60).padStart(2, '0');
    document.getElementById('match-clock').textContent = `${inStoppage ? '+' : ''}${mm}:${ss}`;
  }
  if (G.elapsedSec >= totalSec) {
    if (G.extraTime) {
      if (G.etHalf === 1) startExtraTimeSecondHalf();
      else enterFulltime();
    } else if (G.half === 1) {
      enterHalftime();
    } else {
      enterFulltime();
    }
  }
}

// ============================================================
// Main update / render
// ============================================================
// Smoothly pans/zooms the view toward the ball (pulled a little toward your
// own player too, so a defensive recovery run doesn't take them off-screen),
// then clamps so the zoomed viewport never pans past the drawn pitch area.
function updateCamera(dt) {
  const cam = G.camera;
  const ball = G.ball.pos;
  const targetX = G.controlled ? lerp(ball.x, G.controlled.pos.x, 0.25) : ball.x;
  const targetY = G.controlled ? lerp(ball.y, G.controlled.pos.y, 0.25) : ball.y;
  const dx = targetX - cam.x, dy = targetY - cam.y;
  const d = Math.hypot(dx, dy);
  if (d > CAMERA_DEADZONE) {
    // chase the near edge of the deadzone circle around the target, not the
    // target itself - keeps the camera still while the target's within the
    // deadzone, then smoothly catches up once it wanders further away
    const t = clamp(dt * CAMERA_FOLLOW_SPEED, 0, 1);
    cam.x = lerp(cam.x, targetX - (dx / d) * CAMERA_DEADZONE, t);
    cam.y = lerp(cam.y, targetY - (dy / d) * CAMERA_DEADZONE, t);
  }
  const worldMinX = -MARGIN / SCALE, worldMaxX = PITCH_LEN + MARGIN / SCALE;
  const worldMinY = -MARGIN / SCALE, worldMaxY = PITCH_WID + MARGIN / SCALE;
  const halfVisW = CANVAS_W / (SCALE * cam.zoom) / 2;
  const halfVisH = CANVAS_H / (SCALE * cam.zoom) / 2;
  const loX = worldMinX + halfVisW, hiX = worldMaxX - halfVisW;
  const loY = worldMinY + halfVisH, hiY = worldMaxY - halfVisH;
  cam.x = loX <= hiX ? clamp(cam.x, loX, hiX) : (worldMinX + worldMaxX) / 2;
  cam.y = loY <= hiY ? clamp(cam.y, loY, hiY) : (worldMinY + worldMaxY) / 2;
}

function update(dt) {
  handleHumanMovement(dt);
  // Host-only: team 1's controlled player is driven by whatever the guest
  // last sent over the network instead of local input - see applyGuestMoveInput.
  if (G.online && G.online.role === 'host') applyGuestMoveInput(dt);
  updatePressing(dt);
  updateCamera(dt);
  for (const team of G.teams) {
    for (const p of team.players) {
      const isRestartTaker = G.restart && G.ball.owner === p;
      if (isRestartTaker) {
        if (p !== G.controlled && p !== G.controlled2) handleRestartTaker(p, team, dt);
        p.vel = { x: 0, y: 0 }; // stands still on the restart spot until the ball is away
      } else {
        if (G.ball.owner === p && p !== G.controlled && p !== G.controlled2) aiPossessionDecision(p, team, dt);
        maybeStartRun(p, team, dt);
        aiMovePlayer(p, team, dt);
        if (G.restart) applyRestartRestraint(p, team);
      }
      aiTackleAttempt(p, dt);
    }
  }
  updateBall(dt);
  autoAssignControl();
  updateCrowdTension();
  if (G.ball.owner) G.stats.possession[G.ball.owner.__team] += dt;
  if (G.state === STATE.PLAYING) updateClock(dt);
  maybeBroadcastSnapshot();
  recordReplayFrame();
}

// Throttled (not every frame) - the crowd volume itself eases smoothly via
// setCrowdTension's own ramp, so this doesn't need to run at full frame rate.
function updateCrowdTension() {
  const now = performance.now();
  if (now - G.lastTensionUpdate < 200) return;
  G.lastTensionUpdate = now;
  const b = G.ball.pos;
  const distToNearGoal = Math.min(b.x, PITCH_LEN - b.x);
  const proximity = clamp(1 - distToNearGoal / (BOX_DEPTH * 1.8), 0, 1);
  SFX.setCrowdTension(proximity);
}

// A brief decaying bulge in the net mesh where the ball just hit, same idea
// as a real net billowing outward on the strike then settling - see
// triggerGoalSlowMo, which is where G.netRipple gets set. worldY is in
// pitch metres so the falloff lines up with where the ball actually crossed.
const NET_RIPPLE_DURATION = 0.6, NET_RIPPLE_FREQ = 16;
function netRippleOffset(dir, worldY) {
  if (!G.netRipple || G.netRipple.dir !== dir) return 0;
  const age = (performance.now() - G.netRipple.t) / 1000;
  if (age > NET_RIPPLE_DURATION) return 0;
  const decay = 1 - age / NET_RIPPLE_DURATION;
  const distY = worldY - G.netRipple.y;
  const falloff = Math.exp(-(distY * distY) / 8);
  const push = Math.sin(age * NET_RIPPLE_FREQ) * decay * falloff;
  return push * 6 * (dir === 1 ? 1 : -1); // canvas px, bulging away from the pitch
}

function drawPitchMarkings(ctx) {
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  const x0 = toCanvasX(0), y0 = toCanvasY(0), x1 = toCanvasX(PITCH_LEN), y1 = toCanvasY(PITCH_WID);
  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  // center line
  ctx.beginPath();
  ctx.moveTo(toCanvasX(PITCH_LEN / 2), y0);
  ctx.lineTo(toCanvasX(PITCH_LEN / 2), y1);
  ctx.stroke();
  // center circle + spot
  ctx.beginPath();
  ctx.arc(toCanvasX(PITCH_LEN / 2), toCanvasY(PITCH_WID / 2), CENTER_CIRCLE_R * SCALE, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.fillRect(toCanvasX(PITCH_LEN / 2) - 2, toCanvasY(PITCH_WID / 2) - 2, 4, 4);

  // corner arcs
  const CORNER_ARC_R = 1;
  const corners = [
    { x: 0, y: 0, a0: 0, a1: Math.PI / 2 },
    { x: PITCH_LEN, y: 0, a0: Math.PI / 2, a1: Math.PI },
    { x: PITCH_LEN, y: PITCH_WID, a0: Math.PI, a1: 1.5 * Math.PI },
    { x: 0, y: PITCH_WID, a0: 1.5 * Math.PI, a1: 2 * Math.PI },
  ];
  corners.forEach(c => {
    ctx.beginPath();
    ctx.arc(toCanvasX(c.x), toCanvasY(c.y), CORNER_ARC_R * SCALE, c.a0, c.a1);
    ctx.stroke();
    // corner flag - planted right on the actual corner point where the
    // touchline and goal line meet, pole rising straight up from it
    const fx = toCanvasX(c.x), fy = toCanvasY(c.y);
    const leanX = c.x === 0 ? -1 : 1; // flag leans slightly in from the corner, toward the pitch
    ctx.strokeStyle = '#eeeeee';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.lineTo(fx + leanX * 1.5, fy - 9);
    ctx.stroke();
    ctx.fillStyle = '#ff3b3b';
    ctx.beginPath();
    ctx.moveTo(fx + leanX * 1.5, fy - 9);
    ctx.lineTo(fx + leanX * 7.5, fy - 7);
    ctx.lineTo(fx + leanX * 1.5, fy - 5);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.fillStyle = '#ffffff';
  });

  [1, -1].forEach(dir => {
    const goalX = dir === 1 ? PITCH_LEN : 0;
    const edgeBox = dir === 1 ? PITCH_LEN - BOX_DEPTH : BOX_DEPTH;
    const edgeSix = dir === 1 ? PITCH_LEN - SIX_DEPTH : SIX_DEPTH;
    const topBox = PITCH_WID / 2 - BOX_WIDTH / 2, botBox = PITCH_WID / 2 + BOX_WIDTH / 2;
    const topSix = PITCH_WID / 2 - SIX_WIDTH / 2, botSix = PITCH_WID / 2 + SIX_WIDTH / 2;
    // penalty box
    ctx.strokeRect(toCanvasX(Math.min(goalX, edgeBox)), toCanvasY(topBox), Math.abs(goalX - edgeBox) * SCALE, (botBox - topBox) * SCALE);
    // six yard box
    ctx.strokeRect(toCanvasX(Math.min(goalX, edgeSix)), toCanvasY(topSix), Math.abs(goalX - edgeSix) * SCALE, (botSix - topSix) * SCALE);
    // penalty spot
    const spotX = dir === 1 ? PITCH_LEN - PEN_SPOT_DIST : PEN_SPOT_DIST;
    ctx.fillRect(toCanvasX(spotX) - 2, toCanvasY(PITCH_WID / 2) - 2, 4, 4);
    // penalty arc ("the D") - same radius as the centre circle, bulging out
    // from the box edge on the side facing the middle of the pitch, same as
    // a real pitch's arc (only the part outside the box is actually drawn)
    const dTheta = Math.acos((BOX_DEPTH - PEN_SPOT_DIST) / CENTER_CIRCLE_R);
    const dBase = dir === 1 ? Math.PI : 0;
    ctx.beginPath();
    ctx.arc(toCanvasX(spotX), toCanvasY(PITCH_WID / 2), CENTER_CIRCLE_R * SCALE, dBase - dTheta, dBase + dTheta);
    ctx.stroke();
    // goal frame (drawn just outside the pitch)
    const goalTop = PITCH_WID / 2 - GOAL_WIDTH / 2, goalBot = PITCH_WID / 2 + GOAL_WIDTH / 2;
    ctx.strokeStyle = '#dddddd';
    const netX0 = dir === 1 ? toCanvasX(PITCH_LEN) : toCanvasX(0) - 2 * SCALE;
    const netX1 = netX0 + 2 * SCALE;
    const netY0 = toCanvasY(goalTop), netY1 = toCanvasY(goalBot);
    ctx.strokeRect(netX0, netY0, netX1 - netX0, netY1 - netY0);
    // net mesh - bulges briefly right where a goal was just scored (see
    // netRippleOffset), then settles back flat like a real net would
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    for (let gx = netX0; gx <= netX1; gx += 5) {
      const midY = (netY0 + netY1) / 2;
      const bulge = netRippleOffset(dir, (midY - MARGIN) / SCALE);
      ctx.beginPath();
      ctx.moveTo(gx, netY0);
      ctx.quadraticCurveTo(gx + bulge, midY, gx, netY1);
      ctx.stroke();
    }
    for (let gy = netY0; gy <= netY1; gy += 5) {
      const bulge = netRippleOffset(dir, (gy - MARGIN) / SCALE);
      ctx.beginPath();
      ctx.moveTo(netX0 + bulge, gy);
      ctx.lineTo(netX1 + bulge, gy);
      ctx.stroke();
    }
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
  });
}

// Alternating-colour advertising boards along the touchlines, just outside
// the pitch boundary - stays within the fixed 40px canvas margin.
function drawAdBoards(ctx) {
  const boardDepth = 8;
  const x0 = toCanvasX(0), y0 = toCanvasY(0), x1 = toCanvasX(PITCH_LEN), y1 = toCanvasY(PITCH_WID);
  const colors = ['#1d4ed8', '#dc2626', '#eab308', '#16a34a', '#111827'];
  const segW = 60;
  let i = 0;
  for (let x = x0; x < x1; x += segW) {
    const w = Math.min(segW, x1 - x);
    ctx.fillStyle = colors[i++ % colors.length];
    ctx.fillRect(x, y0 - boardDepth - 2, w, boardDepth);
    ctx.fillRect(x, y1 + 2, w, boardDepth);
  }
}

// Traces a rounded-rectangle path (no ctx.roundRect dependency, so it works
// on any browser) - used for the torso, which reads far less "boxy" than a
// hard-cornered fillRect once combined with a round head instead of a flat
// skin-tone patch.
function roundedRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// stridePhase is a running sine phase (null when stationary) - swings the two
// legs opposite each other for a scissoring stride instead of a static blob.
// skinTone/hairColor are per-player (see SKIN_TONES/HAIR_COLORS) so a full
// squad doesn't read as 11 copies of the same person.
function drawPlayerSprite(ctx, cx, cy, shirt, shorts, controlled, stridePhase, skinTone, hairColor) {
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + 7, 5, 2, 0, 0, Math.PI * 2);
  ctx.fill();

  const strideOffset = stridePhase != null ? Math.sin(stridePhase) * 1.1 : 0;

  // socks (drawn first so a band of each peeks out below the shorts hem)
  ctx.fillStyle = '#f5f5f5';
  ctx.fillRect(cx - 2.6, cy + 2.6 + strideOffset, 1.8, 2.6);
  ctx.fillRect(cx + 0.8, cy + 2.6 - strideOffset, 1.8, 2.6);
  ctx.fillStyle = '#3a2a1a'; // boots
  ctx.fillRect(cx - 2.6, cy + 4.4 + strideOffset, 1.8, 1.8);
  ctx.fillRect(cx + 0.8, cy + 4.4 - strideOffset, 1.8, 1.8);
  ctx.fillStyle = shorts;
  ctx.fillRect(cx - 3, cy + 0.5, 6, 3);
  // a thin lighter hem, same idea as the collar trim below - a plain flat
  // fill reads as a paper cutout, a trim edge reads as actual fabric
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(cx - 3, cy + 3.1, 6, 0.4);

  // arms - swing opposite the same-side leg, same idea as a natural running
  // gait (the web version previously had no arms at all)
  ctx.fillStyle = shirt;
  ctx.fillRect(cx - 4.6, cy - 4.3 - strideOffset * 0.7, 1.3, 4.2);
  ctx.fillRect(cx + 3.3, cy - 4.3 + strideOffset * 0.7, 1.3, 4.2);
  ctx.fillStyle = skinTone;
  ctx.fillRect(cx - 4.6, cy - 0.4 - strideOffset * 0.7, 1.3, 1.1);
  ctx.fillRect(cx + 3.3, cy - 0.4 + strideOffset * 0.7, 1.3, 1.1);

  // neck - closes the gap between torso and head so it doesn't read as a
  // floating skull, matching the player's own skin tone
  ctx.fillStyle = skinTone;
  ctx.fillRect(cx - 1, cy - 5.6, 2, 1.4);

  ctx.fillStyle = shirt;
  roundedRectPath(ctx, cx - 3.5, cy - 5, 7, 6, 1.6);
  ctx.fill();
  // a soft left-lit/right-shaded overlay instead of a flat fill, so the
  // torso reads as rounded rather than a flat colour swatch - an overlay
  // rather than a true colour gradient so it still works over any kit colour
  const shade = ctx.createLinearGradient(cx - 3.5, 0, cx + 3.5, 0);
  shade.addColorStop(0, 'rgba(255,255,255,0.14)');
  shade.addColorStop(0.5, 'rgba(255,255,255,0)');
  shade.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = shade;
  roundedRectPath(ctx, cx - 3.5, cy - 5, 7, 6, 1.6);
  ctx.fill();
  // collar trim - a short pale crew-neck line, a small detail that stops the
  // shirt reading as a flat block of colour
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.arc(cx, cy - 5, 1.6, Math.PI * 0.15, Math.PI * 0.85);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 0.6;
  roundedRectPath(ctx, cx - 3.5, cy - 5, 7, 6, 1.6);
  ctx.stroke();

  ctx.fillStyle = skinTone;
  ctx.beginPath();
  ctx.arc(cx, cy - 7.2, 2.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 0.5;
  ctx.stroke();
  ctx.fillStyle = hairColor; // top half of the head circle only
  ctx.beginPath();
  ctx.arc(cx, cy - 7.2, 2.3, Math.PI, Math.PI * 2);
  ctx.fill();

  if (controlled) {
    ctx.fillStyle = '#ff1e1e';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 12);
    ctx.lineTo(cx - 5, cy - 19);
    ctx.lineTo(cx + 5, cy - 19);
    ctx.closePath();
    ctx.fill();
  }
}

// Regular polygon, pointy-top at `rotation` - used for the ball's pentagon
// panels, which read as noticeably more "football-like" than plain dots.
function drawRegularPolygon(ctx, cx, cy, radius, sides, rotation) {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const ang = rotation + i * (Math.PI * 2 / sides);
    const px = cx + Math.cos(ang) * radius, py = cy + Math.sin(ang) * radius;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

// A short fading streak behind a fast-moving ball - only kicks in above a
// speed threshold, so a rolling/dribbled ball still reads as a solid sphere
// and only a real strike gets the "blur" look.
function drawBallTrail(ctx, cx, cy, vel) {
  const speed = len(vel);
  if (speed < 6) return;
  const dir = norm(vel);
  const trailLen = clamp(speed * 0.55, 4, 13);
  const grad = ctx.createLinearGradient(cx, cy, cx - dir.x * trailLen, cy - dir.y * trailLen);
  grad.addColorStop(0, 'rgba(255,255,255,0.4)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.strokeStyle = grad;
  ctx.lineWidth = BALL_R * 1.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx - dir.x * trailLen, cy - dir.y * trailLen);
  ctx.stroke();
}

const BALL_R = 3; // canvas px - was 4; every other measurement below is scaled from this
function drawBallSprite(ctx, cx, cy, spin) {
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + BALL_R * 0.75, BALL_R, BALL_R * 0.375, 0, 0, Math.PI * 2);
  ctx.fill();

  // a soft gradient instead of flat white gives the ball a rounded, lit-from
  // one-side look rather than a flat paper disc
  const grad = ctx.createRadialGradient(cx - BALL_R * 0.325, cy - BALL_R * 0.325, BALL_R * 0.125, cx, cy, BALL_R * 1.125);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(1, '#cfcfcf');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, BALL_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 0.8;
  ctx.stroke();

  // A classic ball's dark pentagon panels - three around the rim plus one
  // centred, all rotating together with the accumulated spin, so it reads as
  // the whole panel pattern turning rather than a dot orbiting the rim.
  const a = spin || 0;
  ctx.fillStyle = '#222';
  for (let k = 0; k < 3; k++) {
    const ang = a + k * (Math.PI * 2 / 3);
    drawRegularPolygon(ctx, cx + Math.cos(ang) * BALL_R * 0.42, cy + Math.sin(ang) * BALL_R * 0.42, BALL_R * 0.26, 5, ang + Math.PI / 2);
  }
  drawRegularPolygon(ctx, cx, cy, BALL_R * 0.22, 5, a + Math.PI / 2);
}

// myTeam defaults to 0 (every existing single-player/host call site is
// unaffected) - the online guest's own screen passes 1 instead, since their
// own team is always team 1, not team 0 (see render()'s call site).
function drawTackleRange(ctx, myTeam = 0) {
  if (!G.controlled || !G.ball.owner || G.ball.owner.__team === myTeam) return;
  const inRange = dist(G.controlled.pos, G.ball.pos) <= TACKLE_RADIUS;
  ctx.beginPath();
  ctx.arc(toCanvasX(G.controlled.pos.x), toCanvasY(G.controlled.pos.y), TACKLE_RADIUS * SCALE, 0, Math.PI * 2);
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = inRange ? 'rgba(255, 230, 0, 0.9)' : 'rgba(255, 255, 255, 0.4)';
  ctx.stroke();
  ctx.setLineDash([]);
}

// A dashed sightline from the taker to a marker in the goal, only shown while
// actually charging an aimable dead ball - see isAimableShotSituation/G.shotAim.
function drawAimMarker(ctx) {
  if (!G.controlled || G.ball.owner !== G.controlled || !G.charge.shoot || !isAimableShotSituation()) return;
  const team = G.teams[G.controlled.__team];
  const goalX = team.attackDir === 1 ? PITCH_LEN : 0;
  const goalY = PITCH_WID / 2;
  const markerY = goalY + G.shotAim * (GOAL_WIDTH / 2 - 0.5);
  ctx.save();
  ctx.strokeStyle = '#ff1e1e';
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(toCanvasX(G.controlled.pos.x), toCanvasY(G.controlled.pos.y));
  ctx.lineTo(toCanvasX(goalX), toCanvasY(markerY));
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#ff1e1e';
  ctx.beginPath();
  ctx.arc(toCanvasX(goalX), toCanvasY(markerY), 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// A small fuel-gauge-style bar above the controlled player's head - the
// tired-fade in the main render loop already shows staminA visually once it
// gets low, this gives an actual reading of it the whole time instead of
// only noticing once someone's already gassed. Goalkeepers barely move
// (see drainStamina) so it's not shown for them.
function drawStaminaBar(ctx) {
  if (!G.controlled || G.controlled.isGK) return;
  const cx = toCanvasX(G.controlled.pos.x), cy = toCanvasY(G.controlled.pos.y);
  const w = 14, h = 2.4, yOff = -23;
  const pct = clamp(G.controlled.stamina, 0, 1);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(cx - w / 2, cy + yOff, w, h);
  ctx.fillStyle = pct > 0.5 ? '#4ade80' : pct > 0.25 ? '#ffd54f' : '#f87171';
  ctx.fillRect(cx - w / 2, cy + yOff, w * pct, h);
}

// A cheap abstracted crowd - rows of small coloured blocks in the canvas
// margin, baked once same as the grass (regenerating random speckle per
// frame would just flicker). Drawn underneath the grass texture, which now
// only paints the pitch rect itself, so this shows through in the stands
// area above/below the pitch instead of grass running edge-to-edge.
let crowdTexture = null;
function buildCrowdTexture() {
  const tex = document.createElement('canvas');
  tex.width = CANVAS_W;
  tex.height = CANVAS_H;
  const tctx = tex.getContext('2d');
  tctx.fillStyle = '#12181f';
  tctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  const rowH = 5, dotW = 4;
  const colors = ['#c9a34a', '#d94f4f', '#4f7fd9', '#e8e8e8', '#3fae5c', '#8a4fd9', '#2b2b2b'];
  const rows = Math.floor((MARGIN - 10) / rowH);
  for (let row = 0; row < rows; row++) {
    const yTop = row * rowH + 2;
    const yBot = CANVAS_H - (row + 1) * rowH - 2;
    tctx.globalAlpha = 0.5 + row * 0.07; // rows further from the pitch (higher in the stand) read a touch brighter/closer
    for (let x = 0; x < CANVAS_W; x += dotW) {
      if (Math.random() < 0.82) {
        tctx.fillStyle = colors[Math.floor(Math.random() * colors.length)];
        tctx.fillRect(x + rand(-1, 1), yTop, dotW - 1, rowH - 1);
      }
      if (Math.random() < 0.82) {
        tctx.fillStyle = colors[Math.floor(Math.random() * colors.length)];
        tctx.fillRect(x + rand(-1, 1), yBot, dotW - 1, rowH - 1);
      }
    }
  }
  tctx.globalAlpha = 1;
  return tex;
}

// Baked once to an offscreen canvas and reused every frame - grain/fleck
// texture has to be static (the same random dots every frame) to read as
// turf detail; regenerating random speckles per frame would just look like
// flickering static instead. Built lazily on first render() call since it
// needs a real <canvas> to get a 2D context from.
let grassTexture = null;
function buildGrassTexture() {
  const tex = document.createElement('canvas');
  tex.width = CANVAS_W;
  tex.height = CANVAS_H;
  const tctx = tex.getContext('2d');
  // pitch-rect only (not the full canvas) - the margin outside it is left
  // transparent so the crowd texture (drawn underneath, see buildCrowdTexture)
  // shows through instead of grass bleeding into the stands
  tctx.fillStyle = '#2e7d32';
  tctx.fillRect(toCanvasX(0), toCanvasY(0), PITCH_LEN * SCALE, PITCH_WID * SCALE);
  // mowed stripes running goal-to-goal in wide alternating bands, the way a
  // real pitch is actually cut - reads far more like broadcast turf than a
  // checkerboard grid did.
  tctx.fillStyle = 'rgba(255,255,255,0.07)';
  const mowStripes = 9;
  const stripeW = PITCH_LEN / mowStripes;
  for (let i = 0; i < mowStripes; i++) {
    if (i % 2 === 0) continue;
    tctx.fillRect(toCanvasX(i * stripeW), toCanvasY(0), stripeW * SCALE, PITCH_WID * SCALE);
  }
  // a soft diagonal sheen, like raking sunlight/floodlight catching the cut
  // grass - subtle, but stops the turf reading as one uniformly flat colour
  const sheen = tctx.createLinearGradient(toCanvasX(0), toCanvasY(0), toCanvasX(PITCH_LEN), toCanvasY(PITCH_WID));
  sheen.addColorStop(0, 'rgba(255,255,255,0.05)');
  sheen.addColorStop(0.5, 'rgba(255,255,255,0)');
  sheen.addColorStop(1, 'rgba(0,0,0,0.05)');
  tctx.fillStyle = sheen;
  tctx.fillRect(toCanvasX(0), toCanvasY(0), PITCH_LEN * SCALE, PITCH_WID * SCALE);
  // fine blade-level grain - a scatter of tiny light/dark flecks baked once,
  // so individual blades of grass read at close zoom instead of a flat fill
  for (let i = 0; i < 2600; i++) {
    const gx = toCanvasX(rand(0, PITCH_LEN)), gy = toCanvasY(rand(0, PITCH_WID));
    tctx.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
    tctx.fillRect(gx, gy, 1, 1);
  }
  // worn/patchy turf around the goal mouths, penalty spots and centre circle
  // - the parts of a real pitch that take the most foot traffic end up
  // lighter and muddier by full time
  const wornSpots = [
    { x: PITCH_LEN / 2, y: PITCH_WID / 2, r: 6 },
    { x: PEN_SPOT_DIST, y: PITCH_WID / 2, r: 3.5 },
    { x: PITCH_LEN - PEN_SPOT_DIST, y: PITCH_WID / 2, r: 3.5 },
    { x: 2, y: PITCH_WID / 2, r: 4.5 },
    { x: PITCH_LEN - 2, y: PITCH_WID / 2, r: 4.5 },
  ];
  wornSpots.forEach(w => {
    const grad = tctx.createRadialGradient(toCanvasX(w.x), toCanvasY(w.y), 0, toCanvasX(w.x), toCanvasY(w.y), w.r * SCALE);
    grad.addColorStop(0, 'rgba(170,140,70,0.16)');
    grad.addColorStop(1, 'rgba(170,140,70,0)');
    tctx.fillStyle = grad;
    tctx.beginPath();
    tctx.arc(toCanvasX(w.x), toCanvasY(w.y), w.r * SCALE, 0, Math.PI * 2);
    tctx.fill();
  });
  return tex;
}

function render() {
  const canvas = document.getElementById('pitch');
  const ctx = canvas.getContext('2d');
  // Camera transform: everything below still draws in the same logical
  // toCanvasX/toCanvasY space as before (0..CANVAS_W, 0..CANVAS_H) - this
  // just re-centres and scales that space around the camera's focus point,
  // so no drawing code below needs to know the camera exists.
  const z = G.camera.zoom;
  const focusX = toCanvasX(G.camera.x), focusY = toCanvasY(G.camera.y);
  ctx.setTransform(canvasDPR * z, 0, 0, canvasDPR * z, canvasDPR * (CANVAS_W / 2 - focusX * z), canvasDPR * (CANVAS_H / 2 - focusY * z));
  ctx.imageSmoothingEnabled = true;
  if (!crowdTexture) crowdTexture = buildCrowdTexture();
  ctx.drawImage(crowdTexture, 0, 0);
  if (!grassTexture) grassTexture = buildGrassTexture();
  ctx.drawImage(grassTexture, 0, 0);
  // soft vignette - a touch of stadium-lighting depth (darker toward the
  // corners) instead of the grass reading as one flat, evenly-lit colour
  const vignetteCx = toCanvasX(PITCH_LEN / 2), vignetteCy = toCanvasY(PITCH_WID / 2);
  const vignette = ctx.createRadialGradient(vignetteCx, vignetteCy, CANVAS_H * 0.15, vignetteCx, vignetteCy, CANVAS_W * 0.65);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  // a night match (rolled once at kickoff - see G.isNightMatch) darkens
  // everything drawn so far; the actual floodlight glow gets added back in
  // later, additively, once the players/ball are on top of it too
  if (G.isNightMatch) {
    ctx.fillStyle = 'rgba(5,8,18,0.38)';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }
  // wet, overcast wash for a rainy match (rolled once at kickoff - see
  // G.weather/rollWeather) - the falling rain streaks themselves are drawn
  // last, in flat screen-space, so they sit in front of the players/ball too
  if (G.weather === 'rain') {
    ctx.fillStyle = 'rgba(60,70,90,0.18)';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }
  drawAdBoards(ctx);
  drawPitchMarkings(ctx);
  drawDirtParticles(ctx);

  if (G.teams[0] && G.teams[1]) {
    // The online guest's own team is always team 1, not team 0 - see drawTackleRange.
    drawTackleRange(ctx, (G.online && G.online.role === 'guest') ? 1 : 0);
    drawAimMarker(ctx);
    const now = performance.now();
    for (const team of G.teams) {
      for (const p of team.players) {
        const shirt = p.isGK ? team.gkColor : team.shirt;
        const shorts = p.isGK ? '#222' : team.shorts;
        // a light running bob + scissoring leg stride while actually moving,
        // so players don't read as sliding statues
        const moving = len(p.vel) > 0.3;
        const phase = now / 90 + p.noiseSeed;
        const bob = moving ? Math.sin(phase) * 1.2 : 0;
        // a visibly gassed player fades slightly, on top of actually moving slower
        const tired = !p.isGK && p.stamina < 0.45;
        if (tired) ctx.globalAlpha = 0.55 + (p.stamina / 0.45) * 0.45;
        drawPlayerSprite(ctx, toCanvasX(p.pos.x), toCanvasY(p.pos.y) + bob, shirt, shorts, p === G.controlled, moving ? phase : null, p.skinTone, p.hairColor);
        if (tired) ctx.globalAlpha = 1;
      }
    }
    drawBallTrail(ctx, toCanvasX(G.ball.pos.x), toCanvasY(G.ball.pos.y), G.ball.vel);
    drawBallSprite(ctx, toCanvasX(G.ball.pos.x), toCanvasY(G.ball.pos.y), G.ball.spin);
    drawStaminaBar(ctx);
  }
  if (G.isNightMatch) drawFloodlights(ctx);
  drawRain(ctx);
  if (G.state !== STATE.PRACTICE) drawRadar(ctx);
}

// A small fixed-position minimap in the corner showing the whole pitch, both
// teams and the ball as dots - deliberately drawn in raw canvas-pixel space
// (transform reset, ignoring the camera's zoom/pan) since it's a HUD overlay,
// not part of the world the camera looks at. Skipped in Practice, where most
// of the squad is teleported off-pitch (see banishPlayer) and a minimap of
// that wouldn't mean anything.
const RADAR_W = 110, RADAR_H = 72, RADAR_MARGIN = 10, RADAR_PAD = 3;
function drawRadar(ctx) {
  if (!G.teams[0] || !G.teams[1]) return;
  ctx.setTransform(canvasDPR, 0, 0, canvasDPR, 0, 0);
  const rx = (CANVAS_W - RADAR_W) / 2, ry = CANVAS_H - RADAR_H - RADAR_MARGIN;
  ctx.fillStyle = 'rgba(10,20,10,0.65)';
  ctx.fillRect(rx, ry, RADAR_W, RADAR_H);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(rx, ry, RADAR_W, RADAR_H);
  ctx.beginPath();
  ctx.moveTo(rx + RADAR_W / 2, ry);
  ctx.lineTo(rx + RADAR_W / 2, ry + RADAR_H);
  ctx.stroke();

  const sx = (RADAR_W - RADAR_PAD * 2) / PITCH_LEN, sy = (RADAR_H - RADAR_PAD * 2) / PITCH_WID;
  const toRadarX = (wx) => rx + RADAR_PAD + wx * sx;
  const toRadarY = (wy) => ry + RADAR_PAD + wy * sy;
  for (const team of G.teams) {
    for (const p of team.players) {
      const isYou = p === G.controlled;
      ctx.fillStyle = isYou ? '#ffe14d' : (p.isGK ? team.gkColor : team.shirt);
      ctx.beginPath();
      ctx.arc(toRadarX(p.pos.x), toRadarY(p.pos.y), isYou ? 2 : 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(toRadarX(G.ball.pos.x), toRadarY(G.ball.pos.y), 1.6, 0, Math.PI * 2);
  ctx.fill();
}

// Four warm floodlight glows spilling in from just past each corner - only
// shown for a night match (G.isNightMatch, rolled once at kickoff). Drawn
// last with an additive blend so it brightens whatever's underneath (grass,
// markings, players) rather than sitting on top of them as a flat tint.
function drawFloodlights(ctx) {
  const corners = [
    { x: -4, y: -4 }, { x: PITCH_LEN + 4, y: -4 },
    { x: PITCH_LEN + 4, y: PITCH_WID + 4 }, { x: -4, y: PITCH_WID + 4 },
  ];
  ctx.globalCompositeOperation = 'lighter';
  corners.forEach(c => {
    const cx = toCanvasX(c.x), cy = toCanvasY(c.y);
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, CANVAS_W * 0.4);
    glow.addColorStop(0, 'rgba(255,244,214,0.16)');
    glow.addColorStop(1, 'rgba(255,244,214,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  });
  ctx.globalCompositeOperation = 'source-over';
}

// Reuses the same G.joystick analog vector the on-screen joystick already
// writes to, and the same charge-hold flow the keyboard uses for pass/shoot -
// so a connected controller "just works" on top of the existing input plumbing.
function pollGamepad() {
  if (!navigator.getGamepads) return;
  const pads = navigator.getGamepads();
  const gp = pads && pads[0];
  if (!gp) return;
  const lx = gp.axes[0] || 0, ly = gp.axes[1] || 0;
  const mag = Math.hypot(lx, ly);
  if (mag > 0.15) {
    G.joystick.x = clamp(lx, -1, 1);
    G.joystick.y = clamp(ly, -1, 1);
    G.gamepadWasActive = true;
  } else if (G.gamepadWasActive) {
    G.joystick.x = 0;
    G.joystick.y = 0;
    G.gamepadWasActive = false;
  }
  const prev = G.gamepadButtons;
  const now = {};
  [0, 1, 2, 3, 4, 9].forEach(i => { now[i] = !!(gp.buttons[i] && gp.buttons[i].pressed); });
  if (now[0] && !prev[0]) tryHumanTackle();  // A / Cross
  if (now[1] && !prev[1]) trySwitchPlayer(); // B / Circle
  if (now[4] && !prev[4]) callTeammateRun(); // left bumper
  if (now[9] && !prev[9]) togglePause();     // Start
  if (now[2] && !prev[2] && !G.charge.pass) { G.charge.pass = true; G.charge.passStart = performance.now(); } // X / Square
  if (!now[2] && prev[2] && G.charge.pass) onChargeRelease('pass');
  if (now[3] && !prev[3]) { if (!G.charge.shoot) { G.charge.shoot = true; G.charge.shootStart = performance.now(); } startShootoutCharge(); } // Y / Triangle
  if (!now[3] && prev[3]) { if (G.charge.shoot) onChargeRelease('shoot'); releaseShootoutCharge(); }
  G.gamepadButtons = now;
}

function loop(ts) {
  if (!G.lastTs) G.lastTs = ts;
  const dt = Math.min((ts - G.lastTs) / 1000, 0.05) * G.slowMoFactor;
  G.lastTs = ts;
  pollGamepad();
  updateShootoutChargeBar();
  if (G.online && G.online.role === 'guest') { interpolateShadowState(dt); updateCamera(dt); guestSteerAim(dt); sendGuestMoveInput(); }
  else if (G.state === STATE.PLAYING) update(dt);
  else if (G.state === STATE.PRACTICE) updatePractice(dt);
  stepGoalReplay();
  updateDirtParticles(dt);
  updateRain(dt);
  if (G.state === STATE.PLAYING || G.state === STATE.PAUSED || G.state === STATE.GOAL || G.state === STATE.HALFTIME || G.state === STATE.FULLTIME || G.state === STATE.SHOOTOUT || G.state === STATE.PRACTICE) render();
  requestAnimationFrame(loop);
}

// ============================================================
// UI wiring
// ============================================================
function showScreen(id) {
  ['main-menu', 'setup-screen', 'season-setup-screen', 'season-table-screen', 'cup-setup-screen', 'cup-progress-screen', 'practice-setup-screen', 'settings-screen', 'stats-screen', 'career-slots-screen', 'career-club-screen', 'career-dashboard-screen', 'career-lineup-screen', 'career-table-screen', 'career-history-screen', 'career-transfer-screen', 'online-menu-screen', 'online-host-screen', 'online-join-screen', 'online-teampick-screen', 'match-screen'].forEach(s => {
    document.getElementById(s).classList.toggle('hidden', s !== id);
  });
  // Single hook point for every path back to the menu (goToMainMenu's full
  // cleanup, or any of the plain "Back" buttons that just call showScreen
  // directly) - so the Continue Career card is always up to date regardless
  // of which one brought you here.
  if (id === 'main-menu') updateMenuContinueCareerCard();
  // Home shortcut hidden on the main menu itself (redundant) and mid-match
  // (has its own deliberate Pause -> Quit flow instead) - shown everywhere else.
  document.getElementById('btn-home').classList.toggle('hidden', id === 'main-menu' || id === 'match-screen');
}

function goToMainMenu() {
  SFX.stopCrowdAmbience();
  exitFullscreenIfActive();
  if (G.fulltimeTimeout) { clearTimeout(G.fulltimeTimeout); G.fulltimeTimeout = null; }
  if (G.halftimeInterval) { clearInterval(G.halftimeInterval); G.halftimeInterval = null; }
  if (G.goalTimeout) { clearTimeout(G.goalTimeout); G.goalTimeout = null; }
  if (G.slowMoTimeout) { clearTimeout(G.slowMoTimeout); G.slowMoTimeout = null; }
  G.slowMoFactor = 1;
  G.goalPending = false;
  G.replay.active = false;
  G.replay.onDone = null;
  G.replayBuffer = [];
  document.getElementById('replay-badge').classList.add('hidden');
  G.confettiTimeouts.forEach(clearTimeout);
  G.confettiTimeouts = [];
  SEASON = null;
  CUP = null;
  SHOOT = null;
  PRACTICE = null;
  CAREER = null; // already durably saved via saveCareerSlot as you go - this just clears the in-memory reference, same as SEASON/CUP above
  teardownOnline();
  updatePauseButtonForPractice(false);
  pendingSubOut = null;
  document.getElementById('pause-overlay').classList.add('hidden');
  document.getElementById('halftime-overlay').classList.add('hidden');
  document.getElementById('fulltime-overlay').classList.add('hidden');
  document.getElementById('goal-banner').classList.add('hidden');
  document.getElementById('online-lost-overlay').classList.add('hidden');
  document.getElementById('shootout-overlay').classList.add('hidden');
  document.getElementById('season-complete-overlay').classList.add('hidden');
  document.getElementById('subs-overlay').classList.add('hidden');
  // Undo the online guest's "hide substitutions" (see guestHandleMessage) -
  // otherwise a later offline match in this same tab would stay stuck
  // without a Subs button from a previous session as guest.
  document.getElementById('btn-subs').classList.remove('hidden');
  document.getElementById('btn-subs-halftime').classList.remove('hidden');
  document.getElementById('cards-home-list').classList.add('hidden');
  document.getElementById('cards-away-list').classList.add('hidden');
  document.getElementById('event-ticker').innerHTML = '';
  G.eventLog = [];
  G.state = STATE.MENU;
  showScreen('main-menu');
}

// Remembers your last-used match setup (team/opponent/half length/skill)
// across sessions, so returning players don't have to re-pick every time.
const SETTINGS_KEY = 'zacFootballSettings';
function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch (e) { return {}; }
}
function saveSettings(patch) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(Object.assign(loadSettings(), patch))); } catch (e) { /* localStorage unavailable - settings just won't persist */ }
}

// ---------- Save data backup/restore (Settings > Data) ----------
// Everything this game persists lives only in this browser's localStorage -
// clearing site data, switching browsers/devices, or a browser reinstall
// would silently lose every Career save. This bundles all of it (every
// Career slot, lifetime stats, settings, audio prefs) into one downloadable
// file, and can restore from that same file later.
const SAVE_BACKUP_FORMAT = 'retro-ball-save';
function gatherAllSaveData() {
  const careerSlots = {};
  for (let n = 1; n <= CAREER_SLOTS; n++) {
    const data = loadCareerSlot(n);
    if (data) careerSlots[n] = data;
  }
  return {
    format: SAVE_BACKUP_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    careerSlots,
    lifetime: loadLifetime(),
    settings: loadSettings(),
    muted: SFX.isMuted(),
    volume: SFX.getVolume(),
  };
}
function exportSaveData() {
  const bundle = gatherAllSaveData();
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `retro-ball-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  const statusEl = document.getElementById('save-io-status');
  if (statusEl) statusEl.textContent = 'Backup downloaded.';
}
// Confirmed via a native confirm() rather than a custom overlay - this is the
// one genuinely destructive, irreversible action in Settings (overwrites
// every local save), and no lighter-weight confirmation pattern already
// exists elsewhere in this codebase to reuse instead.
function importSaveDataFromFile(file) {
  const statusEl = document.getElementById('save-io-status');
  const reader = new FileReader();
  reader.onload = () => {
    let bundle;
    try { bundle = JSON.parse(reader.result); } catch (e) {
      statusEl.textContent = "That file isn't valid JSON.";
      return;
    }
    if (!bundle || bundle.format !== SAVE_BACKUP_FORMAT || !bundle.careerSlots) {
      statusEl.textContent = "That file isn't a Retro Ball backup.";
      return;
    }
    const slotCount = Object.keys(bundle.careerSlots).length;
    const when = bundle.exportedAt ? new Date(bundle.exportedAt).toLocaleString() : 'an unknown date';
    const ok = window.confirm(
      `This will overwrite your current career saves, stats, and settings on this device with the backup from ${when} ` +
      `(${slotCount} career save${slotCount === 1 ? '' : 's'}). This can't be undone. Continue?`
    );
    if (!ok) { statusEl.textContent = 'Import cancelled.'; return; }
    Object.keys(bundle.careerSlots).forEach(n => saveCareerSlot(Number(n), bundle.careerSlots[n]));
    if (bundle.lifetime) saveLifetime(bundle.lifetime);
    if (bundle.settings) saveSettings(bundle.settings);
    if (bundle.volume != null) SFX.setVolume(bundle.volume);
    if (bundle.muted != null) SFX.setMuted(bundle.muted);
    statusEl.textContent = 'Backup restored - go to Career from the main menu to see your saves.';
  };
  reader.onerror = () => { statusEl.textContent = 'Could not read that file.'; };
  reader.readAsText(file);
}

// ---------- Match Setup (Play) screen - custom team/clock/rank UI ----------
const HALF_LENGTH_OPTIONS = [1, 2, 3, 5, 10];
// Bronze..Champion, in order - shifted two tiers harder than the original
// easy..champion ladder (see SKILLS/DIFFICULTY_OPPONENT_BOOST); a saved
// preference of 'easy'/'medium' from before this change no longer validates
// here and falls back to the new default rank instead.
const RANK_SKILLS = ['hard', 'expert', 'legendary', 'champion', 'grandmaster', 'legend'];
const playSetup = { yourIdx: 0, oppIdx: 1, halfIdx: 1, skillKey: 'expert' };

function renderPlaySetupTeam(which) {
  const idx = which === 'your' ? playSetup.yourIdx : playSetup.oppIdx;
  const def = TEAMS[idx];
  const box = document.getElementById(which === 'your' ? 'setup-team-box' : 'setup-opp-box');
  const nameEl = document.getElementById(which === 'your' ? 'setup-team-name' : 'setup-opp-name');
  box.style.setProperty('--team-color', def.shirt);
  box.style.setProperty('--team-text', readableTextColor(def.shirt));
  nameEl.textContent = def.name;
}

// Same "skip past a collision" behaviour as the old <select> onchange pair -
// cycling your team past whichever club the opponent currently is nudges the
// opponent along instead of letting you pick the same club twice.
function cyclePlaySetupTeam(which, dir) {
  if (which === 'your') {
    playSetup.yourIdx = (playSetup.yourIdx + dir + TEAMS.length) % TEAMS.length;
    if (playSetup.yourIdx === playSetup.oppIdx) playSetup.oppIdx = (playSetup.oppIdx + dir + TEAMS.length) % TEAMS.length;
  } else {
    playSetup.oppIdx = (playSetup.oppIdx + dir + TEAMS.length) % TEAMS.length;
    if (playSetup.oppIdx === playSetup.yourIdx) playSetup.oppIdx = (playSetup.oppIdx + dir + TEAMS.length) % TEAMS.length;
  }
  renderPlaySetupTeam('your');
  renderPlaySetupTeam('opp');
}

function renderPlaySetupHalf() {
  document.getElementById('setup-half-label').textContent = HALF_LENGTH_OPTIONS[playSetup.halfIdx] + ' min';
}

function cyclePlaySetupHalf(dir) {
  playSetup.halfIdx = (playSetup.halfIdx + dir + HALF_LENGTH_OPTIONS.length) % HALF_LENGTH_OPTIONS.length;
  renderPlaySetupHalf();
}

function renderPlaySetupRank() {
  document.querySelectorAll('#setup-screen .rank-tile').forEach(tile => {
    tile.classList.toggle('selected', tile.dataset.skill === playSetup.skillKey);
  });
}

function populateSetupScreen() {
  const saved = loadSettings();
  playSetup.yourIdx = saved.yourIdx != null ? saved.yourIdx : 0;
  playSetup.oppIdx = saved.oppIdx != null ? saved.oppIdx : 1;
  if (playSetup.yourIdx === playSetup.oppIdx) playSetup.oppIdx = (playSetup.yourIdx + 1) % TEAMS.length;
  const savedHalfIdx = HALF_LENGTH_OPTIONS.indexOf(saved.halfLen);
  playSetup.halfIdx = savedHalfIdx !== -1 ? savedHalfIdx : 1;
  playSetup.skillKey = saved.skillKey && RANK_SKILLS.includes(saved.skillKey) ? saved.skillKey : 'expert';

  renderPlaySetupTeam('your');
  renderPlaySetupTeam('opp');
  renderPlaySetupHalf();
  renderPlaySetupRank();

  document.getElementById('setup-team-prev').onclick = () => cyclePlaySetupTeam('your', -1);
  document.getElementById('setup-team-next').onclick = () => cyclePlaySetupTeam('your', 1);
  document.getElementById('setup-opp-prev').onclick = () => cyclePlaySetupTeam('opp', -1);
  document.getElementById('setup-opp-next').onclick = () => cyclePlaySetupTeam('opp', 1);
  document.getElementById('setup-half-prev').onclick = () => cyclePlaySetupHalf(-1);
  document.getElementById('setup-half-next').onclick = () => cyclePlaySetupHalf(1);
  document.querySelectorAll('#setup-screen .rank-tile').forEach(tile => {
    tile.onclick = () => {
      playSetup.skillKey = tile.dataset.skill;
      renderPlaySetupRank();
    };
  });
}

// ---------- Season Setup screen - same custom team/clock/rank UI as Match Setup ----------
const seasonSetup = { yourIdx: 0, halfIdx: 1, skillKey: 'expert' };

function renderSeasonSetupTeam() {
  const def = TEAMS[seasonSetup.yourIdx];
  const box = document.getElementById('season-team-box');
  box.style.setProperty('--team-color', def.shirt);
  box.style.setProperty('--team-text', readableTextColor(def.shirt));
  document.getElementById('season-team-name').textContent = def.name;
}

function cycleSeasonSetupTeam(dir) {
  seasonSetup.yourIdx = (seasonSetup.yourIdx + dir + TEAMS.length) % TEAMS.length;
  renderSeasonSetupTeam();
}

function renderSeasonSetupHalf() {
  document.getElementById('season-half-label').textContent = HALF_LENGTH_OPTIONS[seasonSetup.halfIdx] + ' min';
}

function cycleSeasonSetupHalf(dir) {
  seasonSetup.halfIdx = (seasonSetup.halfIdx + dir + HALF_LENGTH_OPTIONS.length) % HALF_LENGTH_OPTIONS.length;
  renderSeasonSetupHalf();
}

function renderSeasonSetupRank() {
  document.querySelectorAll('#season-setup-screen .rank-tile').forEach(tile => {
    tile.classList.toggle('selected', tile.dataset.skill === seasonSetup.skillKey);
  });
}

function populateSeasonSetupScreen() {
  const saved = loadSettings();
  seasonSetup.yourIdx = saved.seasonYourIdx != null ? saved.seasonYourIdx : 0;
  const savedHalfIdx = HALF_LENGTH_OPTIONS.indexOf(saved.seasonHalfLen);
  seasonSetup.halfIdx = savedHalfIdx !== -1 ? savedHalfIdx : 1;
  seasonSetup.skillKey = saved.seasonSkillKey && RANK_SKILLS.includes(saved.seasonSkillKey) ? saved.seasonSkillKey : 'expert';

  renderSeasonSetupTeam();
  renderSeasonSetupHalf();
  renderSeasonSetupRank();

  document.getElementById('season-team-prev').onclick = () => cycleSeasonSetupTeam(-1);
  document.getElementById('season-team-next').onclick = () => cycleSeasonSetupTeam(1);
  document.getElementById('season-half-prev').onclick = () => cycleSeasonSetupHalf(-1);
  document.getElementById('season-half-next').onclick = () => cycleSeasonSetupHalf(1);
  document.querySelectorAll('#season-setup-screen .rank-tile').forEach(tile => {
    tile.onclick = () => {
      seasonSetup.skillKey = tile.dataset.skill;
      renderSeasonSetupRank();
    };
  });
}

// ---------- Cup Setup screen - same custom team/clock/rank UI ----------
const cupSetup = { yourIdx: 0, halfIdx: 1, skillKey: 'expert' };

function renderCupSetupTeam() {
  const def = TEAMS[cupSetup.yourIdx];
  const box = document.getElementById('cup-team-box');
  box.style.setProperty('--team-color', def.shirt);
  box.style.setProperty('--team-text', readableTextColor(def.shirt));
  document.getElementById('cup-team-name').textContent = def.name;
}

function cycleCupSetupTeam(dir) {
  cupSetup.yourIdx = (cupSetup.yourIdx + dir + TEAMS.length) % TEAMS.length;
  renderCupSetupTeam();
}

function renderCupSetupHalf() {
  document.getElementById('cup-half-label').textContent = HALF_LENGTH_OPTIONS[cupSetup.halfIdx] + ' min';
}

function cycleCupSetupHalf(dir) {
  cupSetup.halfIdx = (cupSetup.halfIdx + dir + HALF_LENGTH_OPTIONS.length) % HALF_LENGTH_OPTIONS.length;
  renderCupSetupHalf();
}

function renderCupSetupRank() {
  document.querySelectorAll('#cup-setup-screen .rank-tile').forEach(tile => {
    tile.classList.toggle('selected', tile.dataset.skill === cupSetup.skillKey);
  });
}

function populateCupSetupScreen() {
  const saved = loadSettings();
  cupSetup.yourIdx = saved.cupYourIdx != null ? saved.cupYourIdx : 0;
  const savedHalfIdx = HALF_LENGTH_OPTIONS.indexOf(saved.cupHalfLen);
  cupSetup.halfIdx = savedHalfIdx !== -1 ? savedHalfIdx : 1;
  cupSetup.skillKey = saved.cupSkillKey && RANK_SKILLS.includes(saved.cupSkillKey) ? saved.cupSkillKey : 'expert';

  renderCupSetupTeam();
  renderCupSetupHalf();
  renderCupSetupRank();

  document.getElementById('cup-team-prev').onclick = () => cycleCupSetupTeam(-1);
  document.getElementById('cup-team-next').onclick = () => cycleCupSetupTeam(1);
  document.getElementById('cup-half-prev').onclick = () => cycleCupSetupHalf(-1);
  document.getElementById('cup-half-next').onclick = () => cycleCupSetupHalf(1);
  document.querySelectorAll('#cup-setup-screen .rank-tile').forEach(tile => {
    tile.onclick = () => {
      cupSetup.skillKey = tile.dataset.skill;
      renderCupSetupRank();
    };
  });
}

// ---------- Practice Setup screen - same custom team/rank UI, plus a
// drill-type selector using the same clock-box arrow-cycling mechanic ----------
const PRACTICE_MODE_OPTIONS = ['penalty', 'freekick'];
const PRACTICE_MODE_LABEL = { penalty: 'Penalties', freekick: 'Free Kicks' };
const practiceSetup = { yourIdx: 0, modeIdx: 0, skillKey: 'expert' };

function renderPracticeSetupTeam() {
  const def = TEAMS[practiceSetup.yourIdx];
  const box = document.getElementById('practice-team-box');
  box.style.setProperty('--team-color', def.shirt);
  box.style.setProperty('--team-text', readableTextColor(def.shirt));
  document.getElementById('practice-team-name').textContent = def.name;
}

function cyclePracticeSetupTeam(dir) {
  practiceSetup.yourIdx = (practiceSetup.yourIdx + dir + TEAMS.length) % TEAMS.length;
  renderPracticeSetupTeam();
}

function renderPracticeSetupMode() {
  document.getElementById('practice-mode-label').textContent = PRACTICE_MODE_LABEL[PRACTICE_MODE_OPTIONS[practiceSetup.modeIdx]];
}

function cyclePracticeSetupMode(dir) {
  practiceSetup.modeIdx = (practiceSetup.modeIdx + dir + PRACTICE_MODE_OPTIONS.length) % PRACTICE_MODE_OPTIONS.length;
  renderPracticeSetupMode();
}

function renderPracticeSetupRank() {
  document.querySelectorAll('#practice-setup-screen .rank-tile').forEach(tile => {
    tile.classList.toggle('selected', tile.dataset.skill === practiceSetup.skillKey);
  });
}

function populatePracticeSetupScreen() {
  const saved = loadSettings();
  practiceSetup.yourIdx = saved.practiceYourIdx != null ? saved.practiceYourIdx : 0;
  const savedModeIdx = PRACTICE_MODE_OPTIONS.indexOf(saved.practiceMode);
  practiceSetup.modeIdx = savedModeIdx !== -1 ? savedModeIdx : 0;
  practiceSetup.skillKey = saved.practiceSkillKey && RANK_SKILLS.includes(saved.practiceSkillKey) ? saved.practiceSkillKey : 'expert';

  renderPracticeSetupTeam();
  renderPracticeSetupMode();
  renderPracticeSetupRank();

  document.getElementById('practice-team-prev').onclick = () => cyclePracticeSetupTeam(-1);
  document.getElementById('practice-team-next').onclick = () => cyclePracticeSetupTeam(1);
  document.getElementById('practice-mode-prev').onclick = () => cyclePracticeSetupMode(-1);
  document.getElementById('practice-mode-next').onclick = () => cyclePracticeSetupMode(1);
  document.querySelectorAll('#practice-setup-screen .rank-tile').forEach(tile => {
    tile.onclick = () => {
      practiceSetup.skillKey = tile.dataset.skill;
      renderPracticeSetupRank();
    };
  });
}

// ---------- Career mode: club-picker screen (new save only) ----------
// Mirrors cupSetup/populateCupSetupScreen exactly (team-box + half-length
// clock + rank grid) - the only difference is "Start" creates a brand new
// CAREER into whichever slot the user picked on the slots screen, tracked in
// careerCreatingSlot rather than reading/writing a season/cup in progress.
const careerClubSetup = { leagueIdx: 0, clubIdx: 0, halfIdx: 1, skillKey: 'expert' };
let careerCreatingSlot = null;

// The club list shown/cycled is always filtered down to whichever league is
// currently selected - clubIdx below is an index into THIS filtered list,
// not directly into ALL_CLUBS (resolved back to a real ALL_CLUBS index only
// once, when the career is actually created - see btn-start-career).
function careerClubSetupList() {
  return ALL_CLUBS.filter(c => c.league === CAREER_LEAGUES[careerClubSetup.leagueIdx]);
}
function renderCareerClubSetupLeague() {
  document.getElementById('career-league-label').textContent = CAREER_LEAGUES[careerClubSetup.leagueIdx];
}
function cycleCareerClubSetupLeague(dir) {
  careerClubSetup.leagueIdx = (careerClubSetup.leagueIdx + dir + CAREER_LEAGUES.length) % CAREER_LEAGUES.length;
  careerClubSetup.clubIdx = 0;
  renderCareerClubSetupLeague();
  renderCareerClubSetupTeam();
}
function renderCareerClubSetupTeam() {
  const def = careerClubSetupList()[careerClubSetup.clubIdx];
  const box = document.getElementById('career-team-box');
  box.style.setProperty('--team-color', def.shirt);
  box.style.setProperty('--team-text', readableTextColor(def.shirt));
  document.getElementById('career-team-name').textContent = def.name;
}
function cycleCareerClubSetupTeam(dir) {
  const list = careerClubSetupList();
  careerClubSetup.clubIdx = (careerClubSetup.clubIdx + dir + list.length) % list.length;
  renderCareerClubSetupTeam();
}
function renderCareerClubSetupHalf() {
  document.getElementById('career-half-label').textContent = HALF_LENGTH_OPTIONS[careerClubSetup.halfIdx] + ' min';
}
function cycleCareerClubSetupHalf(dir) {
  careerClubSetup.halfIdx = (careerClubSetup.halfIdx + dir + HALF_LENGTH_OPTIONS.length) % HALF_LENGTH_OPTIONS.length;
  renderCareerClubSetupHalf();
}
function renderCareerClubSetupRank() {
  document.querySelectorAll('#career-club-screen .rank-tile').forEach(tile => {
    tile.classList.toggle('selected', tile.dataset.skill === careerClubSetup.skillKey);
  });
}
function populateCareerClubScreen() {
  renderCareerClubSetupLeague();
  renderCareerClubSetupTeam();
  renderCareerClubSetupHalf();
  renderCareerClubSetupRank();
  document.getElementById('career-league-prev').onclick = () => cycleCareerClubSetupLeague(-1);
  document.getElementById('career-league-next').onclick = () => cycleCareerClubSetupLeague(1);
  document.getElementById('career-team-prev').onclick = () => cycleCareerClubSetupTeam(-1);
  document.getElementById('career-team-next').onclick = () => cycleCareerClubSetupTeam(1);
  document.getElementById('career-half-prev').onclick = () => cycleCareerClubSetupHalf(-1);
  document.getElementById('career-half-next').onclick = () => cycleCareerClubSetupHalf(1);
  document.querySelectorAll('#career-club-screen .rank-tile').forEach(tile => {
    tile.onclick = () => {
      careerClubSetup.skillKey = tile.dataset.skill;
      renderCareerClubSetupRank();
    };
  });
}

// ---------- Career mode: slots / dashboard / transfer market rendering ----------
// Same position colour-coding convention most football games use, so the
// squad/transfer list reads at a glance instead of needing every label read.
const POSITION_COLOR = { GK: '#eab308', DEF: '#3b82f6', MID: '#22c55e', FWD: '#ef4444' };

function formatCareerPlayerRow(cp, actionLabel, actionHandler) {
  const card = document.createElement('div');
  card.className = 'player-card';
  card.style.setProperty('--pos-color', POSITION_COLOR[cp.group] || '#64748b');
  const detail = cp.league ? `${cp.group}, age ${cp.age} — ${cp.club} (${cp.league})` : `${cp.group}, age ${cp.age}`;
  card.innerHTML = `<span><span class="player-name">${cp.name}</span><span class="player-meta">${detail} — value £${cp.value}m${cp.careerGoals ? ` — ${cp.careerGoals} career goal${cp.careerGoals === 1 ? '' : 's'}` : ''}</span></span>`;
  const btn = document.createElement('button');
  btn.textContent = actionLabel;
  btn.onclick = actionHandler;
  card.appendChild(btn);
  return card;
}

// Six boxes filling the whole screen (top row of 3, bottom row of 3) - same
// team-box component the team pickers use, club-coloured via --team-color,
// just laid out in a column (see .career-save-box). The back button lives
// inside the bottom-left box specifically, overlapping its corner exactly
// like every other setup screen's back button does.
function renderCareerSlotsScreen() {
  const topRow = document.getElementById('career-slots-top');
  const bottomRow = document.getElementById('career-slots-bottom');
  topRow.innerHTML = '';
  bottomRow.innerHTML = '';
  listCareerSlots().forEach(({ slot, data }) => {
    const box = document.createElement('div');
    box.className = 'team-box career-save-box';
    if (data) {
      const def = ALL_CLUBS[data.clubIdx];
      const clubName = def ? def.name : '?';
      if (def) {
        box.style.setProperty('--team-color', def.shirt);
        box.style.setProperty('--team-text', readableTextColor(def.shirt));
      }
      const r = data.record;
      const gd = r.gf - r.ga;
      box.innerHTML = `
        <span class="slot-num">Slot ${slot}</span>
        <span class="slot-club">${clubName}</span>
        <span class="slot-detail">Season ${data.seasonNumber} — £${data.budget}m</span>
        <span class="slot-detail">P${r.played} W${r.won} D${r.drawn} L${r.lost}</span>
        <span class="slot-detail">Pts ${r.points} · GD ${gd >= 0 ? '+' : ''}${gd}</span>
        <span class="slot-detail">Squad: ${data.squad.length}</span>`;
      const actions = document.createElement('div');
      actions.className = 'slot-actions';
      const loadBtn = document.createElement('button');
      loadBtn.textContent = 'Continue';
      loadBtn.onclick = () => { CAREER = data; restoreCareerNextPlayerId(data); saveSettings({ lastCareerSlot: slot }); showCareerDashboard(); };
      const delBtn = document.createElement('button');
      delBtn.textContent = 'Delete';
      delBtn.onclick = () => { deleteCareerSlot(slot); renderCareerSlotsScreen(); };
      actions.appendChild(loadBtn);
      actions.appendChild(delBtn);
      box.appendChild(actions);
    } else {
      box.innerHTML = `<span class="slot-num">Slot ${slot}</span><span class="slot-detail">Empty</span>`;
      const newBtn = document.createElement('button');
      newBtn.textContent = 'New Career';
      newBtn.onclick = () => {
        careerCreatingSlot = slot;
        populateCareerClubScreen();
        showScreen('career-club-screen');
      };
      box.appendChild(newBtn);
    }
    (slot <= 3 ? topRow : bottomRow).appendChild(box);
  });
  const backBtn = document.createElement('button');
  backBtn.className = 'back-btn-overlap';
  backBtn.textContent = 'Back';
  backBtn.onclick = () => { showScreen('main-menu'); };
  bottomRow.firstChild.appendChild(backBtn);
}

function showCareerDashboard() {
  reapplyRealAges(CAREER);
  renderCareerDashboard();
  showScreen('career-dashboard-screen');
}

function renderCareerDashboard() {
  const club = ALL_CLUBS[CAREER.clubIdx];
  const clubBox = document.getElementById('career-club-box');
  clubBox.style.setProperty('--team-color', club.shirt);
  clubBox.style.setProperty('--team-text', readableTextColor(club.shirt));
  document.getElementById('career-dashboard-title').textContent = club.name;
  document.getElementById('career-club-league').textContent = CAREER.clubLeague;
  const r = CAREER.record;
  const stat = (label, value) => `<div class="season-stat-chip"><span class="stat-value">${value}</span><span class="stat-label">${label}</span></div>`;
  document.getElementById('career-dashboard-stats').innerHTML = `<div class="season-stat-row">` +
    stat('Season', CAREER.seasonNumber) + stat('Budget', `£${CAREER.budget}m`) + stat('Played', r.played) +
    stat('Won', r.won) + stat('Drawn', r.drawn) + stat('Lost', r.lost) + stat('Points', r.points) + `</div>` +
    `<div class="season-stat-row">` +
    stat('🏆 Titles', CAREER.leagueTitlesWon) + stat('Domestic Cups', CAREER.faCupsWon) + stat('League Cups', CAREER.leagueCupsWon) +
    stat('Champions League', CAREER.uclTitlesWon || 0) + stat('Europa League', CAREER.uelTitlesWon || 0) + `</div>`;
  const offerCount = (CAREER.incomingOffers || []).length;
  const offersBadge = document.getElementById('career-offers-badge');
  offersBadge.textContent = offerCount;
  offersBadge.classList.toggle('hidden', offerCount === 0);
  // Previously the season-complete summary only ever showed as a side-effect
  // of two specific buttons (Sim, or dismissing Full Time) - if neither of
  // those exact clicks happened next (e.g. backing out and reopening the
  // save), it was silently lost. Checking it here instead means it's visible
  // the moment the dashboard renders, however the season actually ended.
  document.getElementById('career-season-summary-badge').classList.toggle('hidden', !CAREER.lastSeasonSummary);
  const fixtureBox = document.getElementById('career-fixture-box');
  const fixtureEl = document.getElementById('career-next-fixture');
  if (CAREER.fixtureIdx < CAREER.fixtures.length) {
    const fixture = CAREER.fixtures[CAREER.fixtureIdx];
    const opp = ALL_CLUBS[fixture.oppIdx];
    fixtureBox.style.setProperty('--team-color', opp.shirt);
    fixtureBox.style.setProperty('--team-text', readableTextColor(opp.shirt));
    // Competition label rendered as its own short line rather than
    // concatenated into the team name string - that combined string
    // (e.g. "Champions League — vs Borussia Mönchengladbach") could run well
    // past this box's team-box-name truncation width, ellipsis-cutting off
    // before the actual opponent name was even visible.
    document.getElementById('career-fixture-competition').textContent = fixtureCompetitionLabel(fixture) || '';
    fixtureEl.textContent = `vs ${opp.name}`;
  } else {
    fixtureBox.style.setProperty('--team-color', '#333');
    document.getElementById('career-fixture-competition').textContent = '';
    fixtureEl.textContent = 'Season complete';
  }
}

// Picks a nominal best XI (highest average attribute per position, capped at
// the chosen formation's counts - see CAREER_FORMATIONS/CAREER.formationKey)
// so the lineup screen has a stable, sensible team to show rather than the
// random subset applyCareerSquad draws fresh for each actual match. Everyone
// else is a reserve.
// CAREER.customLineup (sparse, keyed by formation-slot index) holds any
// slots you've manually picked via the lineup screen's pitch-then-reserve
// swap - see renderCareerLineupScreen. Anything not explicitly picked (or
// whose pick is stale - sold/released/retired) still falls back to the old
// auto-pick behaviour, so a thin or freshly-signed squad never breaks.
function getCareerLineup(ctx) {
  ctx = ctx || CAREER;
  const formation = CAREER_FORMATIONS[ctx.formationKey] || FORMATION;
  const avgAttr = cp => (cp.pace + cp.tackling + cp.finishing + cp.reflexes) / 4;
  const pools = {};
  ['GK', 'DEF', 'MID', 'FWD'].forEach(g => {
    pools[g] = ctx.squad.filter(cp => cp.group === g).sort((a, b) => avgAttr(b) - avgAttr(a));
  });
  const used = new Set();
  const custom = ctx.customLineup || {};
  const starters = formation.map((slot, i) => {
    const pickedId = custom[i];
    if (pickedId != null) {
      const cp = ctx.squad.find(p => p.id === pickedId && p.group === slot.group);
      if (cp && !used.has(cp.id)) { used.add(cp.id); return { slot, cp }; }
    }
    return { slot, cp: null };
  }).map(entry => {
    if (entry.cp) return entry;
    const cp = (pools[entry.slot.group] || []).find(p => !used.has(p.id));
    if (cp) used.add(cp.id);
    return { slot: entry.slot, cp: cp || null };
  });
  const reserves = ctx.squad.filter(cp => !used.has(cp.id));
  return { starters, reserves };
}

// Snapshots every currently-showing starter into CAREER.customLineup as an
// explicit pick, using the CURRENT getCareerLineup() result (before whatever
// change is about to be made). Needed before changing just one slot -
// otherwise getCareerLineup's auto-fill pass re-runs its greedy best-
// available-first pick for every OTHER slot too the moment one slot's
// occupant changes, cascading everyone else into different slots instead of
// a clean one-for-one change. Returns the pre-change starters list so the
// caller can still read who was where before overwriting anything further.
function pinCurrentLineup(ctx) {
  ctx = ctx || CAREER;
  const { starters } = getCareerLineup(ctx);
  ctx.customLineup = ctx.customLineup || {};
  starters.forEach((entry, i) => {
    if (entry.cp) ctx.customLineup[i] = entry.cp.id;
  });
  return starters;
}

// Fixed row height per position instead of using each formation's own x
// value directly - keeps the four lines evenly, generously spread down the
// pitch regardless of which formation is picked, rather than being however
// bunched-up that formation's own depth values happen to be.
const LINEUP_ROW_TOP = { GK: 92, DEF: 68, MID: 38, FWD: 10 };

// A specific real-football position name for a formation slot - purely
// cosmetic (pitch marker + hover tooltip only). slot.group (DEF/MID/FWD) -
// what the player actually plays as, and how the transfer market sorts
// them - never changes; a wide MID/FWD slot showing as "Right Wing" still
// plays and buys/sells exactly like any other MID/FWD.
// "Wide" means genuinely hugging the touchline (y within 0.2 of either
// edge) - not just "not exactly central". A 4-3-3's three midfielders sit
// at y=0.25/0.50/0.75, which is spread out but still a purely central
// 3-man midfield in real football (no LM/RM at all) - the old 0.3/0.7
// threshold caught those and mislabelled them as wide. This tighter 0.2/0.8
// band still correctly catches genuine wide slots elsewhere (4-4-2's
// y=0.15/0.85 wide midfielders, a back-4's y=0.15/0.85 full-backs, a
// back-3's y=0.25/0.50/0.75 which correctly has NO wide slots at all since
// real back-threes don't have full-backs either).
function isWideSlot(slot) { return slot.y <= 0.2 || slot.y >= 0.8; }
function slotPositionAbbr(slot) {
  const wide = isWideSlot(slot);
  const side = slot.y < 0.5 ? 'L' : 'R';
  if (slot.group === 'GK') return 'GK';
  if (slot.group === 'DEF') return wide ? `${side}B` : 'CB';
  // Wide MID stays a midfielder (LM/RM) - "wing" specifically means the
  // wide FWD slot below, a more advanced role, not just any wide player.
  if (slot.group === 'MID') return wide ? `${side}M` : (slot.x < 0.4 ? 'DM' : 'CM');
  if (slot.group === 'FWD') return wide ? `${side}W` : 'ST';
  return slot.group;
}
function slotPositionName(slot) {
  const wide = isWideSlot(slot);
  const side = slot.y < 0.5 ? 'Left' : 'Right';
  if (slot.group === 'GK') return 'Goalkeeper';
  if (slot.group === 'DEF') return wide ? `${side} Back` : 'Centre Back';
  if (slot.group === 'MID') return wide ? `${side} Midfield` : (slot.x < 0.4 ? 'Defensive Midfield' : 'Central Midfield');
  if (slot.group === 'FWD') return wide ? `${side} Wing` : 'Striker';
  return GROUP_LABEL[slot.group] || slot.group;
}

// Which starting-XI slot (an index into the current formation array) is
// currently selected for swapping, if any - see renderCareerLineupScreen's
// pitch-marker/reserve-card click handlers. Reset whenever the screen is
// left or the formation changes (a different formation invalidates slot
// indices' meaning).
let careerLineupSelectedSlot = null;
// Which {clubIdx, squad, formationKey, customLineup}-shaped context the
// lineup screen below is currently editing - defaults to the real, saved
// CAREER, but online match setup points this at a throwaway context instead
// (see buildOnlineLineupContext) so the exact same screen/logic works for
// a one-off match with nothing persisted to localStorage. lineupReturnScreen
// is just which screen the Back button should return to for whichever
// caller opened this.
let activeLineupCtx = CAREER;
let lineupReturnScreen = 'career-dashboard-screen';

// Only meaningful for a real persistent career - a throwaway online context
// has no save slot and nothing else references it once the match starts,
// so there's nothing to write to localStorage.
function saveActiveLineupCtxIfCareer() {
  if (activeLineupCtx === CAREER) saveCareerSlot(CAREER.slot, CAREER);
}

// Picks a starting reserve into whichever pitch slot is currently selected -
// shared by both the Career "Start" button (alongside Release) and the
// online lineup screen's single "Start" button (see renderCareerLineupScreen).
function startReserveIntoSelectedSlot(cp) {
  if (careerLineupSelectedSlot == null) { showToast('Select a starting player on the pitch first', '#eab308'); return; }
  const formation = CAREER_FORMATIONS[activeLineupCtx.formationKey] || FORMATION;
  const slot = formation[careerLineupSelectedSlot];
  if (slot.group !== cp.group) {
    showToast(`${cp.name} plays ${GROUP_LABEL[cp.group]}, not ${GROUP_LABEL[slot.group]}`, '#e63946');
    return;
  }
  pinCurrentLineup(activeLineupCtx);
  activeLineupCtx.customLineup[careerLineupSelectedSlot] = cp.id;
  careerLineupSelectedSlot = null;
  saveActiveLineupCtxIfCareer();
  renderCareerLineupScreen();
}

// The starting XI on a pitch at their formation spot, clickable to pick a
// slot to swap - click a pitch marker, then click a same-position reserve
// to swap them in (see activeLineupCtx.customLineup/getCareerLineup).
// Reserves as a scrollable action list alongside it, with a formation
// picker (prev/next arrows) underneath that - changing it actually
// reshapes the team for real matches too, see applyCareerSquad.
function renderCareerLineupScreen() {
  const ctx = activeLineupCtx;
  const club = ALL_CLUBS[ctx.clubIdx];
  const { starters, reserves } = getCareerLineup(ctx);
  const pitch = document.getElementById('formation-pitch');
  pitch.innerHTML = '';
  starters.forEach(({ slot, cp }, i) => {
    const marker = document.createElement('div');
    marker.className = 'formation-player' + (careerLineupSelectedSlot === i ? ' selected' : '');
    // y (lateral spread) maps onto the horizontal axis; vertical position
    // comes from the fixed per-group row, not the formation's own x value -
    // see LINEUP_ROW_TOP.
    marker.style.left = `${slot.y * 100}%`;
    marker.style.top = `${LINEUP_ROW_TOP[slot.group]}%`;
    const dot = document.createElement('div');
    dot.className = 'formation-player-dot';
    dot.style.setProperty('--kit-color', club.shirt);
    dot.style.setProperty('--kit-text', readableTextColor(club.shirt));
    dot.textContent = slotPositionAbbr(slot);
    marker.title = slotPositionName(slot);
    const nameEl = document.createElement('div');
    nameEl.className = 'formation-player-name';
    nameEl.textContent = cp ? cp.name : '—';
    marker.appendChild(dot);
    marker.appendChild(nameEl);
    marker.onclick = () => {
      if (careerLineupSelectedSlot == null) {
        careerLineupSelectedSlot = i;
        renderCareerLineupScreen();
        return;
      }
      if (careerLineupSelectedSlot === i) {
        careerLineupSelectedSlot = null; // clicking the same one again just deselects
        renderCareerLineupScreen();
        return;
      }
      // A second, different starter clicked while one was already selected -
      // swap the two players between their slots, so you can move someone
      // to wherever you actually want them within the XI, not just bring a
      // reserve on. Restricted to same-group slots (e.g. two DEF slots) -
      // moving someone into a different group's slot would mean playing
      // out of position for real (wrong attribute weighting in-match), not
      // something a cosmetic reshuffle should allow.
      const formation = CAREER_FORMATIONS[ctx.formationKey] || FORMATION;
      const slotA = formation[careerLineupSelectedSlot];
      const slotB = formation[i];
      if (slotA.group !== slotB.group) {
        showToast(`Can't swap a ${GROUP_LABEL[slotA.group]} into a ${GROUP_LABEL[slotB.group]} slot`, '#e63946');
        careerLineupSelectedSlot = null;
        renderCareerLineupScreen();
        return;
      }
      const beforeSwap = pinCurrentLineup(ctx);
      const playerA = beforeSwap[careerLineupSelectedSlot].cp;
      const playerB = beforeSwap[i].cp;
      if (playerA) ctx.customLineup[i] = playerA.id; else delete ctx.customLineup[i];
      if (playerB) ctx.customLineup[careerLineupSelectedSlot] = playerB.id; else delete ctx.customLineup[careerLineupSelectedSlot];
      careerLineupSelectedSlot = null;
      saveActiveLineupCtxIfCareer();
      renderCareerLineupScreen();
    };
    pitch.appendChild(marker);
  });
  document.getElementById('career-formation-label').textContent = ctx.formationKey;
  const list = document.getElementById('career-reserves-list');
  list.innerHTML = '';
  // Releasing a player only makes sense for a real persistent squad (it
  // permanently sells them off your career save) - a throwaway online
  // context just gets a single Start button instead, no Release at all.
  reserves.slice().sort((a, b) => a.group.localeCompare(b.group)).forEach(cp => {
    if (ctx === CAREER) {
      const card = formatCareerPlayerRow(cp, 'Release', () => {
        releasePlayer(cp);
        renderCareerLineupScreen();
      });
      // Group Release + Start together as one flex child, rather than letting
      // .player-card's own space-between spread three items unevenly across
      // this fairly narrow panel.
      const releaseBtn = card.lastElementChild;
      const actions = document.createElement('div');
      actions.className = 'career-lineup-actions';
      card.appendChild(actions);
      actions.appendChild(releaseBtn);
      const startBtn = document.createElement('button');
      startBtn.className = 'career-lineup-start-btn';
      startBtn.textContent = 'Start';
      startBtn.onclick = () => startReserveIntoSelectedSlot(cp);
      actions.appendChild(startBtn);
      list.appendChild(card);
    } else {
      list.appendChild(formatCareerPlayerRow(cp, 'Start', () => startReserveIntoSelectedSlot(cp)));
    }
  });
}

function cycleCareerFormation(dir) {
  const ctx = activeLineupCtx;
  const i = CAREER_FORMATION_KEYS.indexOf(ctx.formationKey);
  ctx.formationKey = CAREER_FORMATION_KEYS[(i + dir + CAREER_FORMATION_KEYS.length) % CAREER_FORMATION_KEYS.length];
  ctx.customLineup = {}; // a different formation's slot indices don't mean the same thing
  careerLineupSelectedSlot = null;
  saveActiveLineupCtxIfCareer();
  renderCareerLineupScreen();
}

// Clears any manual starting-XI picks, back to the auto best-XI-by-attribute
// pick (see getCareerLineup).
function resetCareerLineupToAuto() {
  activeLineupCtx.customLineup = {};
  careerLineupSelectedSlot = null;
  saveActiveLineupCtxIfCareer();
  renderCareerLineupScreen();
}

// Your real live record slotted in alongside the season's table estimate
// (see generateLeagueTableEstimate) and sorted together, so you can see
// roughly where the title race/relegation battle actually stands.
function renderCareerTableScreen() {
  const you = { clubIdx: CAREER.clubIdx, points: CAREER.record.points, gd: CAREER.record.gf - CAREER.record.ga, isYou: true };
  const table = [you, ...CAREER.tableEstimate].sort((a, b) => b.points - a.points || b.gd - a.gd);
  document.getElementById('career-table-body').innerHTML = table.map((row, i) => {
    const def = ALL_CLUBS[row.clubIdx];
    return `<tr${row.isYou ? ' class="career-table-you"' : ''}><td>${i + 1}</td><td>${def.name}</td><td>${row.points}</td><td>${row.gd >= 0 ? '+' : ''}${row.gd}</td></tr>`;
  }).join('');
}

// Shown once a career season ends (see endCareerSeason's seasonSummary/
// CAREER.lastSeasonSummary) - has to be closed with the Continue button
// rather than the game silently carrying on to the next season/dashboard.
function showSeasonCompleteOverlay(summary) {
  const club = ALL_CLUBS[CAREER.clubIdx];
  document.getElementById('season-complete-club').textContent = `${club.name} — Season ${summary.season} (${summary.league})`;
  const r = summary.record;
  const stat = (label, value) => `<div class="season-stat-chip"><span class="stat-value">${value}</span><span class="stat-label">${label}</span></div>`;
  document.getElementById('season-complete-stats').innerHTML =
    stat('Position', `${summary.finalRank} of ${summary.leagueSize}`) + stat('Points', r.points) +
    stat('Played', r.played) + stat('Won', r.won) + stat('Drawn', r.drawn) + stat('Lost', r.lost) +
    stat('Scored', r.gf) + stat('Conceded', r.ga);
  const badges = [];
  if (summary.champion) badges.push('<span class="career-trophy-badge">🏆 League Champions</span>');
  if (summary.trophies.facup) badges.push(`<span class="career-trophy-badge">🏆 ${DOMESTIC_CUP_NAME[summary.league] || 'Domestic Cup'}</span>`);
  if (summary.trophies.leaguecup) badges.push('<span class="career-trophy-badge">🏆 League Cup</span>');
  if (summary.trophies.ucl) badges.push('<span class="career-trophy-badge">🏆 Champions League</span>');
  if (summary.trophies.uel) badges.push('<span class="career-trophy-badge">🏆 Europa League</span>');
  if (summary.promoted) badges.push('<span class="career-trophy-badge promo">⬆️ Promoted</span>');
  if (summary.relegated) badges.push('<span class="career-trophy-badge releg">⬇️ Relegated</span>');
  document.getElementById('season-complete-trophies').innerHTML = badges.join('');
  document.getElementById('season-complete-overlay').classList.remove('hidden');
}

// Every completed season, most recent first, collapsed to a summary line -
// click a row to expand its full stats in place. See endCareerSeason's
// seasonSummary shape (CAREER.seasonHistory).
// Every game played (league, both domestic cups, European group/knockout
// legs) - newest first, so the most recent result is the first thing seen.
// See pushCareerMatchLog (applyCareerFixtureResult) for where rows come from.
const MATCHLOG_RESULT_COLOR = { W: '#4ade80', D: '#9ca3af', L: '#e63946' };
function renderCareerMatchLog() {
  const list = document.getElementById('career-matchlog-list');
  const log = (CAREER.matchLog || []).slice().reverse();
  if (!log.length) {
    list.innerHTML = '<p class="hint-text">No games played yet.</p>';
    return;
  }
  list.innerHTML = log.map(m => {
    const opp = ALL_CLUBS[m.oppIdx] ? ALL_CLUBS[m.oppIdx].name : 'Unknown';
    const color = MATCHLOG_RESULT_COLOR[m.result] || '#9ca3af';
    return `<div class="career-matchlog-row">
      <span class="career-matchlog-result" style="--result-color:${color}">${m.result}</span>
      <span class="career-matchlog-opp">vs ${opp}</span>
      <span class="career-matchlog-score">${m.gf}-${m.ga}</span>
      <span class="career-matchlog-comp">${m.competition}</span>
    </div>`;
  }).join('');
}

function renderCareerHistoryScreen() {
  renderCareerMatchLog();
  const list = document.getElementById('career-history-list');
  list.innerHTML = '';
  const history = (CAREER.seasonHistory || []).slice().reverse();
  if (!history.length) {
    list.innerHTML = '<p class="hint-text">No seasons completed yet.</p>';
    return;
  }
  history.forEach(summary => {
    const row = document.createElement('div');
    row.className = 'career-history-row';
    const r = summary.record;
    const trophyIcons = [
      summary.champion ? '🏆' : '', summary.trophies.facup ? '🎗️' : '', summary.trophies.leaguecup ? '🥤' : '',
      summary.trophies.ucl ? '⭐' : '', summary.trophies.uel ? '🌟' : '',
      summary.promoted ? '⬆️' : '', summary.relegated ? '⬇️' : '',
    ].filter(Boolean).join(' ');
    const cells = [
      ['Played', r.played], ['Won', r.won], ['Drawn', r.drawn], ['Lost', r.lost], ['Scored', r.gf], ['Conceded', r.ga],
    ].map(([label, value]) => `<div class="season-stat-chip"><span class="stat-value">${value}</span><span class="stat-label">${label}</span></div>`).join('');
    row.innerHTML = `
      <div class="career-history-row-head">
        <span>Season ${summary.season} — ${summary.league}</span>
        <span>${summary.finalRank} of ${summary.leagueSize} — ${r.points} pts</span>
        <span class="career-history-trophies">${trophyIcons}</span>
      </div>
      <div class="career-history-detail"><div class="season-stat-row">${cells}</div></div>`;
    row.onclick = () => row.classList.toggle('expanded');
    list.appendChild(row);
  });
}

// Which source the transfer market is currently narrowed to - 'All', 'Free
// Agents', or one of the league names getTransferPool's clubs can carry
// (see formatCareerPlayerRow/cp.league). Persists across re-renders of this
// screen (signing a player re-renders it) but resets whenever the screen is
// opened fresh, same lifetime as careerClubSetup's own screen-local state.
let careerMarketFilter = 'All';

// Transfer pool split into four columns by position, one going across, with
// a row of source filter buttons above (All / Free Agents / one per league
// currently in the pool) so you're not scrolling through every eligible
// league's entire squad at once to find one player.
// Which tab of the Transfer Market screen is showing - 'buy' (the existing
// 4-column view) or 'offers' (incoming offers on your own players, see
// generateIncomingOffers/resolveOffer). Set explicitly by the tab buttons,
// and defaulted sensibly (to 'offers' if any are pending) the moment the
// screen is opened fresh - see btn-career-transfers' own handler.
let careerMarketTab = 'buy';

// One card per pending incoming offer - Accept sells immediately at the
// offered price; Counter expands the card in place with the three fixed
// tiers (see COUNTER_TIERS) rather than a separate overlay; Reject just
// closes the offer with nothing changing hands. All three funnel through
// resolveOffer, which always removes the offer from the queue either way.
function renderCareerOffersList() {
  const list = document.getElementById('career-offers-list');
  list.innerHTML = '';
  const offers = CAREER.incomingOffers || [];
  if (!offers.length) {
    list.innerHTML = '<p class="hint-text">No offers right now - check back after the season ends.</p>';
    return;
  }
  offers.forEach(offer => {
    const card = document.createElement('div');
    card.className = 'career-offer-card';
    card.innerHTML = `<div class="career-offer-head">
      <span class="player-name">${offer.playerName}</span>
      <span class="player-meta">${GROUP_LABEL[offer.playerGroup] || offer.playerGroup} — ${offer.clubName} offers £${offer.amount}m</span>
    </div>`;
    const actions = document.createElement('div');
    actions.className = 'career-offer-actions';
    const acceptBtn = document.createElement('button');
    acceptBtn.className = 'career-offer-accept-btn';
    acceptBtn.textContent = `Accept £${offer.amount}m`;
    const counterBtn = document.createElement('button');
    counterBtn.className = 'career-offer-counter-btn';
    counterBtn.textContent = 'Counter';
    const rejectBtn = document.createElement('button');
    rejectBtn.className = 'career-offer-reject-btn';
    rejectBtn.textContent = 'Reject';
    acceptBtn.onclick = () => {
      resolveOffer(offer.id, offer.amount);
      showToast(`✅ Sold ${offer.playerName} to ${offer.clubName} for £${offer.amount}m (+£${Math.round(offer.amount * SELL_CUT)}m after fees)`, '#4ade80');
      renderCareerOffersList();
      renderCareerDashboard();
    };
    rejectBtn.onclick = () => {
      resolveOffer(offer.id, null);
      showToast(`Turned down ${offer.clubName}'s offer for ${offer.playerName}`, '#9ca3af');
      renderCareerOffersList();
    };
    counterBtn.onclick = () => {
      const tierRow = document.createElement('div');
      tierRow.className = 'career-offer-tiers';
      COUNTER_TIERS.forEach(tier => {
        const askAmount = Math.round(offer.amount * (1 + tier.pct));
        const tierBtn = document.createElement('button');
        tierBtn.className = 'career-offer-tier-btn';
        tierBtn.textContent = `Ask £${askAmount}m (+${Math.round(tier.pct * 100)}%)`;
        tierBtn.onclick = () => {
          if (Math.random() < tier.acceptChance) {
            resolveOffer(offer.id, askAmount);
            showToast(`✅ ${offer.clubName} accepted £${askAmount}m for ${offer.playerName}! +£${Math.round(askAmount * SELL_CUT)}m`, '#4ade80');
          } else {
            resolveOffer(offer.id, null);
            showToast(`${offer.clubName} walked away - too much for ${offer.playerName}`, '#e63946');
          }
          renderCareerOffersList();
          renderCareerDashboard();
        };
        tierRow.appendChild(tierBtn);
      });
      card.appendChild(tierRow);
      [acceptBtn, counterBtn, rejectBtn].forEach(b => { b.disabled = true; });
    };
    actions.appendChild(acceptBtn);
    actions.appendChild(counterBtn);
    actions.appendChild(rejectBtn);
    card.appendChild(actions);
    list.appendChild(card);
  });
}

function renderCareerTransferScreen() {
  document.getElementById('career-budget-display').textContent = `Budget: £${CAREER.budget}m`;
  const offerCount = (CAREER.incomingOffers || []).length;
  document.getElementById('btn-market-tab-buy').classList.toggle('active', careerMarketTab === 'buy');
  document.getElementById('btn-market-tab-offers').classList.toggle('active', careerMarketTab === 'offers');
  document.getElementById('btn-market-tab-offers').textContent = `Offers Received${offerCount ? ` (${offerCount})` : ''}`;
  document.getElementById('career-market-buy-panel').classList.toggle('hidden', careerMarketTab !== 'buy');
  document.getElementById('career-offers-list').classList.toggle('hidden', careerMarketTab !== 'offers');
  if (careerMarketTab === 'offers') { renderCareerOffersList(); return; }
  const pool = getTransferPool();
  const leaguesInPool = [...new Set(pool.filter(cp => cp.league).map(cp => cp.league))];
  const hasFreeAgents = pool.some(cp => !cp.league);
  const filters = ['All', ...(hasFreeAgents ? ['Free Agents'] : []), ...leaguesInPool];
  if (!filters.includes(careerMarketFilter)) careerMarketFilter = 'All';
  const filterBar = document.getElementById('career-market-filters');
  filterBar.innerHTML = '';
  filters.forEach(f => {
    const btn = document.createElement('button');
    btn.className = 'career-market-filter-btn' + (f === careerMarketFilter ? ' active' : '');
    btn.textContent = f;
    btn.onclick = () => { careerMarketFilter = f; renderCareerTransferScreen(); };
    filterBar.appendChild(btn);
  });
  const filtered = pool.filter(cp => {
    if (careerMarketFilter === 'All') return true;
    if (careerMarketFilter === 'Free Agents') return !cp.league;
    return cp.league === careerMarketFilter;
  });
  const cols = {
    GK: document.getElementById('career-market-gk'),
    DEF: document.getElementById('career-market-def'),
    MID: document.getElementById('career-market-mid'),
    FWD: document.getElementById('career-market-fwd'),
  };
  Object.values(cols).forEach(col => { col.innerHTML = ''; });
  filtered.forEach(cp => {
    const col = cols[cp.group];
    if (!col) return;
    col.appendChild(formatCareerPlayerRow(cp, `Sign £${cp.value}m`, () => {
      // Signing removes a row and the whole list reflows - without an
      // explicit confirmation of WHO was actually signed, that reflow reads
      // as "I signed the wrong player" even when the right one went through.
      const name = cp.name, value = cp.value;
      if (signPlayer(cp)) {
        showToast(`✅ Signed ${name} for £${value}m`, '#4ade80');
        renderCareerTransferScreen();
      } else {
        showToast('Not enough budget', '#e63946');
      }
    }));
  });
}

document.addEventListener('DOMContentLoaded', () => {
  populateSetupScreen();
  populateSeasonSetupScreen();
  populateCupSetupScreen();
  populatePracticeSetupScreen();

  // Apply any previously-saved keybinds/kit-clash sensitivity before anything
  // else touches KEYS/KIT_CLASH_THRESHOLD.
  const savedGlobal = loadSettings();
  if (savedGlobal.keys) Object.assign(KEYS, savedGlobal.keys);
  applyKitSensitivity(savedGlobal.kitClashSensitivity || 'normal');
  updateKeyHints();
  G.reducedMotion = !!savedGlobal.reducedMotion;
  G.camera.zoom = savedGlobal.cameraZoom || CAMERA_ZOOM;
  applyControlsSwap(!!savedGlobal.controlsSwapped);
  G.customizeControls = !!savedGlobal.customizeControls;
  applySavedControlPositions();
  // showScreen('main-menu') only fires when something actually navigates
  // back to it - the menu is just visible by default on first page load, so
  // this needs its own explicit first call to cover that case.
  updateMenuContinueCareerCard();
  document.getElementById('btn-home').onclick = () => goToMainMenu();

  document.getElementById('btn-settings').onclick = () => {
    renderKeybindList();
    document.getElementById('settings-volume').value = Math.round(SFX.getVolume() * 100);
    document.getElementById('settings-mute').checked = SFX.isMuted();
    const level = loadSettings().kitClashSensitivity || 'normal';
    document.getElementById('kit-sensitivity-normal').classList.toggle('active', level === 'normal');
    document.getElementById('kit-sensitivity-high').classList.toggle('active', level === 'high');
    document.getElementById('kit-sensitivity-colorblind').classList.toggle('active', level === 'colorblind');
    const s = loadSettings();
    document.getElementById('settings-reduced-motion').checked = !!s.reducedMotion;
    document.getElementById('settings-camera-zoom').value = Math.round((s.cameraZoom || CAMERA_ZOOM) * 100);
    document.getElementById('settings-controls-swap').checked = !!s.controlsSwapped;
    document.getElementById('settings-controls-customize').checked = !!s.customizeControls;
    document.getElementById('save-io-status').textContent = '';
    showScreen('settings-screen');
  };
  document.getElementById('btn-settings-back').onclick = () => { showScreen('main-menu'); };
  document.getElementById('settings-volume').oninput = (e) => { SFX.setVolume(e.target.value / 100); };
  document.getElementById('settings-mute').onchange = (e) => { SFX.setMuted(e.target.checked); };
  document.getElementById('settings-reduced-motion').onchange = (e) => {
    G.reducedMotion = e.target.checked;
    saveSettings({ reducedMotion: e.target.checked });
  };
  document.getElementById('settings-camera-zoom').oninput = (e) => {
    const zoom = e.target.value / 100;
    G.camera.zoom = zoom;
    saveSettings({ cameraZoom: zoom });
  };
  document.getElementById('settings-controls-swap').onchange = (e) => {
    applyControlsSwap(e.target.checked);
    saveSettings({ controlsSwapped: e.target.checked });
  };
  document.getElementById('settings-controls-customize').onchange = (e) => {
    G.customizeControls = e.target.checked;
    saveSettings({ customizeControls: e.target.checked });
    updateControlsCustomizeVisibility();
  };
  document.getElementById('btn-reset-controls-position').onclick = () => { resetControlPositions(); };
  document.getElementById('btn-export-save').onclick = () => exportSaveData();
  document.getElementById('btn-import-save').onclick = () => document.getElementById('import-save-file-input').click();
  document.getElementById('import-save-file-input').onchange = (e) => {
    const file = e.target.files[0];
    if (file) importSaveDataFromFile(file);
    e.target.value = ''; // reset so re-selecting the same file still fires 'change'
  };
  // One click handler shared by all three kit-sensitivity buttons rather than
  // three near-identical copies - each just toggles its own level on.
  function applyKitSensitivity(level) {
    KIT_CLASH_THRESHOLD = level === 'high' ? KIT_CLASH_HIGH : KIT_CLASH_NORMAL;
    KIT_CLASH_COLORBLIND = level === 'colorblind';
    document.getElementById('kit-sensitivity-normal').classList.toggle('active', level === 'normal');
    document.getElementById('kit-sensitivity-high').classList.toggle('active', level === 'high');
    document.getElementById('kit-sensitivity-colorblind').classList.toggle('active', level === 'colorblind');
  }
  ['normal', 'high', 'colorblind'].forEach(level => {
    document.getElementById(`kit-sensitivity-${level}`).onclick = () => {
      applyKitSensitivity(level);
      saveSettings({ kitClashSensitivity: level });
    };
  });

  document.getElementById('btn-fullscreen').onclick = () => toggleFullscreen();
  document.getElementById('btn-stats').onclick = () => { renderStatsScreen(); showScreen('stats-screen'); };
  document.getElementById('btn-stats-back').onclick = () => { showScreen('main-menu'); };

  document.getElementById('btn-online').onclick = () => { showScreen('online-menu-screen'); };
  document.getElementById('btn-online-back').onclick = () => { showScreen('main-menu'); };
  document.getElementById('btn-online-host').onclick = () => {
    SFX.warmup();
    document.getElementById('online-host-code').value = '';
    setOnlineHostStatus('');
    showScreen('online-host-screen');
    startOnlineHost();
  };
  document.getElementById('btn-online-host-back').onclick = () => { teardownOnline(); showScreen('online-menu-screen'); };
  document.getElementById('btn-online-host-copy').onclick = () => { copyTextFromBox('online-host-code'); };

  document.getElementById('online-league-prev').onclick = () => cycleOnlineTeamPickLeague(-1);
  document.getElementById('online-league-next').onclick = () => cycleOnlineTeamPickLeague(1);
  document.getElementById('online-team-prev').onclick = () => cycleOnlineTeamPickTeam(-1);
  document.getElementById('online-team-next').onclick = () => cycleOnlineTeamPickTeam(1);
  document.getElementById('online-half-prev').onclick = () => cycleOnlineTeamPickHalf(-1);
  document.getElementById('online-half-next').onclick = () => cycleOnlineTeamPickHalf(1);
  document.getElementById('btn-online-squad').onclick = () => {
    const clubIdx = ALL_CLUBS.indexOf(onlineTeamPickList()[onlineTeamPick.clubIdx]);
    activeLineupCtx = ensureOnlineLineupCtx(clubIdx);
    lineupReturnScreen = 'online-teampick-screen';
    careerLineupSelectedSlot = null;
    renderCareerLineupScreen();
    showScreen('career-lineup-screen');
  };
  document.getElementById('btn-online-ready').onclick = () => { onlineReadyClicked(); };
  document.getElementById('btn-online-teampick-back').onclick = () => { teardownOnline(); showScreen('online-menu-screen'); };
  document.getElementById('btn-online-lost-menu').onclick = () => { goToMainMenu(); };

  document.getElementById('btn-online-join').onclick = () => {
    SFX.warmup();
    document.getElementById('online-join-code-input').value = '';
    setOnlineJoinStatus('');
    showScreen('online-join-screen');
  };
  document.getElementById('btn-online-join-back').onclick = () => { teardownOnline(); showScreen('online-menu-screen'); };
  document.getElementById('btn-online-join-submit').onclick = () => { joinOnlineWithCode(); };
  document.getElementById('online-join-code-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinOnlineWithCode();
  });
  // Codes are always generated upper-case (see relay-server's ROOM_ALPHABET)
  // and matched case-insensitively either way - this just makes what you see
  // as you type match that, instead of showing lowercase until you hit Join.
  document.getElementById('online-join-code-input').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase();
  });

  document.getElementById('btn-career').onclick = () => { renderCareerSlotsScreen(); showScreen('career-slots-screen'); };
  document.getElementById('btn-career-club-back').onclick = () => { showScreen('career-slots-screen'); };
  document.getElementById('btn-start-career').onclick = () => {
    SFX.warmup();
    const { halfIdx, skillKey } = careerClubSetup;
    const clubIdx = ALL_CLUBS.indexOf(careerClubSetupList()[careerClubSetup.clubIdx]);
    newCareer(careerCreatingSlot, clubIdx, HALF_LENGTH_OPTIONS[halfIdx], skillKey);
    showCareerDashboard();
  };
  document.getElementById('btn-career-play').onclick = () => { SFX.warmup(); startCareerMatch(); };
  document.getElementById('btn-career-sim').onclick = () => {
    careerSimNextFixture();
    renderCareerDashboard();
    if (CAREER.lastSeasonSummary) {
      const summary = CAREER.lastSeasonSummary;
      CAREER.lastSeasonSummary = null;
      showSeasonCompleteOverlay(summary);
    }
  };
  document.getElementById('btn-career-transfers').onclick = () => {
    careerMarketTab = (CAREER.incomingOffers || []).length > 0 ? 'offers' : 'buy';
    renderCareerTransferScreen();
    showScreen('career-transfer-screen');
  };
  document.getElementById('btn-career-transfer-back').onclick = () => { showCareerDashboard(); };
  document.getElementById('btn-market-tab-buy').onclick = () => { careerMarketTab = 'buy'; renderCareerTransferScreen(); };
  document.getElementById('btn-market-tab-offers').onclick = () => { careerMarketTab = 'offers'; renderCareerTransferScreen(); };
  document.getElementById('btn-career-squad').onclick = () => {
    activeLineupCtx = CAREER;
    lineupReturnScreen = 'career-dashboard-screen';
    renderCareerLineupScreen();
    showScreen('career-lineup-screen');
  };
  document.getElementById('btn-career-lineup-back').onclick = () => {
    careerLineupSelectedSlot = null;
    if (activeLineupCtx === CAREER) showCareerDashboard();
    else showScreen(lineupReturnScreen);
  };
  document.getElementById('btn-formation-prev').onclick = () => cycleCareerFormation(-1);
  document.getElementById('btn-formation-next').onclick = () => cycleCareerFormation(1);
  document.getElementById('btn-lineup-auto').onclick = () => resetCareerLineupToAuto();
  document.getElementById('btn-career-table').onclick = () => { renderCareerTableScreen(); showScreen('career-table-screen'); };
  document.getElementById('career-season-summary-badge').onclick = () => {
    if (!CAREER.lastSeasonSummary) return;
    const summary = CAREER.lastSeasonSummary;
    CAREER.lastSeasonSummary = null;
    renderCareerDashboard();
    showSeasonCompleteOverlay(summary);
  };
  document.getElementById('btn-career-table-back').onclick = () => { showCareerDashboard(); };
  document.getElementById('career-club-box').onclick = () => { renderCareerHistoryScreen(); showScreen('career-history-screen'); };
  document.getElementById('btn-career-history-back').onclick = () => { showCareerDashboard(); };
  document.getElementById('btn-career-save-exit').onclick = () => { saveCareerSlot(CAREER.slot, CAREER); goToMainMenu(); };
  document.getElementById('btn-continue-career').onclick = () => {
    document.getElementById('fulltime-overlay').classList.add('hidden');
    showCareerDashboard();
    if (CAREER.lastSeasonSummary) {
      const summary = CAREER.lastSeasonSummary;
      CAREER.lastSeasonSummary = null;
      showSeasonCompleteOverlay(summary);
    }
  };
  document.getElementById('btn-season-complete-continue').onclick = () => {
    document.getElementById('season-complete-overlay').classList.add('hidden');
  };

  document.getElementById('btn-play').onclick = () => { showScreen('setup-screen'); };
  document.getElementById('btn-season').onclick = () => { showScreen('season-setup-screen'); };
  document.getElementById('btn-season-back-menu').onclick = () => { showScreen('main-menu'); };
  document.getElementById('btn-start-season').onclick = () => {
    SFX.warmup();
    const { yourIdx, skillKey } = seasonSetup;
    const halfLen = HALF_LENGTH_OPTIONS[seasonSetup.halfIdx];
    saveSettings({ seasonYourIdx: yourIdx, seasonHalfLen: halfLen, seasonSkillKey: skillKey });
    startSeason(yourIdx, halfLen, skillKey);
  };
  document.getElementById('btn-season-next').onclick = () => { startSeasonMatch(); };
  document.getElementById('btn-season-quit').onclick = () => { goToMainMenu(); };
  document.getElementById('btn-continue-season').onclick = () => {
    document.getElementById('fulltime-overlay').classList.add('hidden');
    renderSeasonTable();
    showScreen('season-table-screen');
  };

  document.getElementById('btn-cup').onclick = () => { showScreen('cup-setup-screen'); };
  document.getElementById('btn-cup-back-menu').onclick = () => { showScreen('main-menu'); };
  document.getElementById('btn-start-cup').onclick = () => {
    SFX.warmup();
    const { yourIdx, skillKey } = cupSetup;
    const halfLen = HALF_LENGTH_OPTIONS[cupSetup.halfIdx];
    saveSettings({ cupYourIdx: yourIdx, cupHalfLen: halfLen, cupSkillKey: skillKey });
    startCup(yourIdx, halfLen, skillKey);
    showScreen('match-screen');
  };
  document.getElementById('btn-cup-next').onclick = () => { startCupMatch(); };
  document.getElementById('btn-cup-quit').onclick = () => { goToMainMenu(); };
  document.getElementById('btn-continue-cup').onclick = () => {
    document.getElementById('fulltime-overlay').classList.add('hidden');
    renderCupProgress();
    showScreen('cup-progress-screen');
  };
  document.getElementById('btn-shootout-kick').addEventListener('pointerdown', (e) => { e.preventDefault(); startShootoutCharge(); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(evt => {
    document.getElementById('btn-shootout-kick').addEventListener(evt, (e) => { e.preventDefault(); releaseShootoutCharge(); });
  });

  document.getElementById('btn-practice').onclick = () => { showScreen('practice-setup-screen'); };
  document.getElementById('btn-practice-back-menu').onclick = () => { showScreen('main-menu'); };
  document.getElementById('btn-start-practice').onclick = () => {
    SFX.warmup();
    const { yourIdx, skillKey } = practiceSetup;
    const mode = PRACTICE_MODE_OPTIONS[practiceSetup.modeIdx];
    saveSettings({ practiceYourIdx: yourIdx, practiceMode: mode, practiceSkillKey: skillKey });
    startPractice(yourIdx, mode, skillKey);
    showScreen('match-screen');
  };

  document.getElementById('btn-exit').onclick = () => {
    window.close();
    setTimeout(() => { alert("Your browser won't let a page close its own tab - you can close this tab manually now."); }, 300);
  };
  document.getElementById('btn-back-menu').onclick = () => { showScreen('main-menu'); };

  document.getElementById('btn-start-match').onclick = () => {
    SFX.warmup();
    const { yourIdx, oppIdx, skillKey } = playSetup;
    const halfLen = HALF_LENGTH_OPTIONS[playSetup.halfIdx];
    saveSettings({ yourIdx, oppIdx, halfLen, skillKey });
    initMatch(yourIdx, oppIdx, halfLen, skillKey);
    showScreen('match-screen');
  };

  document.getElementById('btn-pause').onclick = togglePause;
  document.getElementById('btn-resume').onclick = togglePause;
  const muteBtn = document.getElementById('btn-mute');
  const updateMuteBtn = () => { muteBtn.textContent = SFX.isMuted() ? '\u{1F507}' : '\u{1F50A}'; };
  updateMuteBtn();
  muteBtn.onclick = () => { SFX.setMuted(!SFX.isMuted()); updateMuteBtn(); };
  document.getElementById('btn-quit-to-menu').onclick = goToMainMenu;
  document.getElementById('btn-continue-halftime').onclick = endHalftime;

  const openSubs = () => {
    pendingSubOut = null;
    renderSubsScreen();
    document.getElementById('subs-overlay').classList.remove('hidden');
  };
  document.getElementById('btn-subs').onclick = openSubs;
  document.getElementById('btn-subs-halftime').onclick = openSubs;
  document.getElementById('btn-subs-close').onclick = () => {
    document.getElementById('subs-overlay').classList.add('hidden');
  };
  document.getElementById('subs-onpitch').addEventListener('click', (e) => {
    const btn = e.target.closest('.sub-off-btn');
    if (!btn || btn.disabled) return;
    pendingSubOut = G.teams[0].players[parseInt(btn.dataset.idx)];
    renderSubsScreen();
  });
  document.getElementById('subs-bench').addEventListener('click', (e) => {
    const btn = e.target.closest('.sub-on-btn');
    if (!btn || btn.disabled || !pendingSubOut) return;
    substitutePlayer(G.teams[0], pendingSubOut, G.teams[0].bench[parseInt(btn.dataset.bench)]);
    pendingSubOut = null;
    renderSubsScreen();
  });

  document.getElementById('cards-home-btn').onclick = () => {
    document.getElementById('cards-home-list').classList.toggle('hidden');
    document.getElementById('cards-away-list').classList.add('hidden');
  };
  document.getElementById('cards-away-btn').onclick = () => {
    document.getElementById('cards-away-list').classList.toggle('hidden');
    document.getElementById('cards-home-list').classList.add('hidden');
  };
  document.getElementById('btn-fulltime-menu').onclick = goToMainMenu;
  document.getElementById('btn-rematch').onclick = () => {
    if (!lastMatchSettings) return;
    if (G.fulltimeTimeout) { clearTimeout(G.fulltimeTimeout); G.fulltimeTimeout = null; }
    document.getElementById('fulltime-overlay').classList.add('hidden');
    const { yourIdx, oppIdx, halfLenMin, skillKey } = lastMatchSettings;
    initMatch(yourIdx, oppIdx, halfLenMin, skillKey);
    showScreen('match-screen');
  };
  document.getElementById('btn-rotate-dismiss').onclick = () => {
    document.getElementById('rotate-hint').classList.remove('enabled');
  };

  document.getElementById('controls-toggle').onclick = () => {
    const body = document.getElementById('controls-body');
    const collapsed = body.classList.toggle('hidden');
    document.getElementById('controls-toggle').innerHTML = collapsed ? 'Controls &#9656;' : 'Controls &#9662;';
  };

  // True while a real text field (a room code box, a settings input, etc.)
  // has focus - game controls are ignored entirely in that case, so typing
  // a keybind letter (W/A/S/D/J/K/L/Q/R/P by default) actually types into
  // the field instead of being hijacked as a game input.
  function isTypingIntoField() {
    const el = document.activeElement;
    return !!(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'));
  }
  window.addEventListener('keydown', (e) => {
    if (isTypingIntoField()) return;
    const k = e.key.toLowerCase();
    if (Object.values(KEYS).includes(k)) e.preventDefault();
    G.keysDown[k] = true;
    if (e.repeat) return;
    if (k === KEYS.pause) togglePause();
    if (k === KEYS.tackle) tryHumanTackle();
    if (k === KEYS.switchPlayer) trySwitchPlayer();
    if (k === KEYS.run) callTeammateRun();
    if (k === KEYS.pass && !G.charge.pass) { G.charge.pass = true; G.charge.passStart = performance.now(); }
    if (k === KEYS.shoot && !G.charge.shoot) { G.charge.shoot = true; G.charge.shootStart = performance.now(); }
    if (k === KEYS.shoot) startShootoutCharge(); // no-ops unless a shootout is actually waiting on your kick
  });
  window.addEventListener('keyup', (e) => {
    if (isTypingIntoField()) return;
    const k = e.key.toLowerCase();
    G.keysDown[k] = false;
    if (k === KEYS.pass && G.charge.pass) onChargeRelease('pass');
    if (k === KEYS.shoot && G.charge.shoot) onChargeRelease('shoot');
    if (k === KEYS.shoot) releaseShootoutCharge();
  });
  // If the window loses focus (e.g. alt-tab) no keyup ever arrives, which would
  // otherwise leave movement/charge keys stuck "held" forever. Also auto-pause
  // so nothing happens (a goal against you, a card) while you're not looking.
  window.addEventListener('blur', () => {
    G.keysDown = {};
    G.charge.pass = false;
    G.charge.shoot = false;
    G.joystick.x = 0;
    G.joystick.y = 0;
    pauseGame();
  });
  // Covers phone app-switching / screen lock, which doesn't always fire 'blur'.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseGame();
  });

  setupCanvasDPI();
  window.addEventListener('resize', setupCanvasDPI);
  window.addEventListener('orientationchange', setupCanvasDPI);

  setupTouchControls();
  requestAnimationFrame(loop);
});

// ============================================================
// On-screen touch controls (same underlying state as the keyboard)
// ============================================================
function setupJoystick() {
  const base = document.getElementById('joystick-base');
  const stick = document.getElementById('joystick-stick');
  const maxR = 35; // px the stick can travel from its base's centre
  let activePointerId = null;

  function setFromClient(clientX, clientY) {
    const rect = base.getBoundingClientRect();
    const dx = clientX - (rect.left + rect.width / 2);
    const dy = clientY - (rect.top + rect.height / 2);
    const d = Math.min(Math.hypot(dx, dy), maxR);
    const angle = Math.atan2(dy, dx);
    const sx = Math.cos(angle) * d, sy = Math.sin(angle) * d;
    stick.style.transform = `translate(${sx}px, ${sy}px)`;
    G.joystick.x = sx / maxR;
    G.joystick.y = sy / maxR;
  }

  function reset() {
    stick.style.transform = 'translate(0px, 0px)';
    G.joystick.x = 0;
    G.joystick.y = 0;
    activePointerId = null;
  }

  base.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    activePointerId = e.pointerId;
    base.setPointerCapture(e.pointerId);
    setFromClient(e.clientX, e.clientY);
  });
  base.addEventListener('pointermove', (e) => {
    if (e.pointerId !== activePointerId) return;
    e.preventDefault();
    setFromClient(e.clientX, e.clientY);
  });
  const end = (e) => { if (e.pointerId === activePointerId) reset(); };
  base.addEventListener('pointerup', end);
  base.addEventListener('pointercancel', end);
}

function bindChargeButton(id, kind) {
  const el = document.getElementById(id);
  const startKey = kind === 'pass' ? 'passStart' : 'shootStart';
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (!G.charge[kind]) { G.charge[kind] = true; G.charge[startKey] = performance.now(); }
  });
  const release = (e) => { e.preventDefault(); if (G.charge[kind]) onChargeRelease(kind); };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointerleave', release);
  el.addEventListener('pointercancel', release);
}

function setTouchControlsVisible(show) {
  document.getElementById('touch-controls').classList.toggle('hidden', !show);
  document.getElementById('btn-toggle-input').textContent = show ? 'Keyboard Controls' : 'Touch Controls';
  if (show) updateControlsCustomizeVisibility();
}

function setupTouchControls() {
  setupJoystick();
  bindChargeButton('td-pass', 'pass');
  bindChargeButton('td-shoot', 'shoot');
  document.getElementById('td-tackle').addEventListener('pointerdown', (e) => { e.preventDefault(); tryHumanTackle(); });
  document.getElementById('td-switch').addEventListener('pointerdown', (e) => { e.preventDefault(); trySwitchPlayer(); });
  document.getElementById('td-run').addEventListener('pointerdown', (e) => { e.preventDefault(); callTeammateRun(); });
  setupControlsCustomization();

  let touchControlsOn = window.matchMedia('(pointer: coarse)').matches;
  setTouchControlsVisible(touchControlsOn);
  document.getElementById('btn-toggle-input').onclick = () => {
    touchControlsOn = !touchControlsOn;
    setTouchControlsVisible(touchControlsOn);
  };
}

// Settings > Touch Controls > "Swap Sides" - mirrors which side the joystick
// vs the action buttons land on (see .controls-swapped in style.css).
function applyControlsSwap(swapped) {
  document.getElementById('touch-controls').classList.toggle('controls-swapped', swapped);
}

// Settings > Touch Controls > "Customize Positions" - reveals the drag
// handles (see .control-drag-handle) over the joystick/action-button groups
// so they can be dragged instead of used to actually play, without ever
// confusing a real steer/tackle/pass input with a reposition drag.
function updateControlsCustomizeVisibility() {
  document.getElementById('joystick-drag-handle').classList.toggle('hidden', !G.customizeControls);
  document.getElementById('actions-drag-handle').classList.toggle('hidden', !G.customizeControls);
}

// Writes a percentage-based position directly onto the joystick/actions
// wrapper, overriding its normal flex placement - percentages are relative to
// the viewport (see the top:0 note on #touch-controls in style.css) so this
// lines up with the window.innerWidth/innerHeight math in makeControlDraggable.
function applyControlPosition(wrap, leftPct, topPct) {
  wrap.style.position = 'absolute';
  wrap.style.left = leftPct + '%';
  wrap.style.top = topPct + '%';
  wrap.style.bottom = 'auto';
  wrap.style.right = 'auto';
}

function applySavedControlPositions() {
  const s = loadSettings();
  if (s.joystickPos) applyControlPosition(document.getElementById('touch-joystick'), s.joystickPos.left, s.joystickPos.top);
  if (s.actionsPos) applyControlPosition(document.getElementById('touch-actions'), s.actionsPos.left, s.actionsPos.top);
}

// Undoes applyControlPosition, letting the wrapper fall back to its normal
// flex-based placement (and whatever handedness swap is currently set).
function resetControlPositions() {
  ['touch-joystick', 'touch-actions'].forEach(id => {
    const el = document.getElementById(id);
    el.style.position = ''; el.style.left = ''; el.style.top = ''; el.style.bottom = ''; el.style.right = '';
  });
  saveSettings({ joystickPos: null, actionsPos: null });
}

function makeControlDraggable(handle, wrap, settingsKey) {
  let dragPointerId = null, startClientX = 0, startClientY = 0, startLeftPct = 0, startTopPct = 0;
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    dragPointerId = e.pointerId;
    handle.setPointerCapture(e.pointerId);
    startClientX = e.clientX;
    startClientY = e.clientY;
    const rect = wrap.getBoundingClientRect();
    startLeftPct = (rect.left / window.innerWidth) * 100;
    startTopPct = (rect.top / window.innerHeight) * 100;
  });
  handle.addEventListener('pointermove', (e) => {
    if (e.pointerId !== dragPointerId) return;
    e.preventDefault();
    const leftPct = clamp(startLeftPct + ((e.clientX - startClientX) / window.innerWidth) * 100, 0, 90);
    const topPct = clamp(startTopPct + ((e.clientY - startClientY) / window.innerHeight) * 100, 0, 90);
    applyControlPosition(wrap, leftPct, topPct);
  });
  const end = (e) => {
    if (e.pointerId !== dragPointerId) return;
    dragPointerId = null;
    const rect = wrap.getBoundingClientRect();
    const leftPct = (rect.left / window.innerWidth) * 100;
    const topPct = (rect.top / window.innerHeight) * 100;
    saveSettings({ [settingsKey]: { left: leftPct, top: topPct } });
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

function setupControlsCustomization() {
  makeControlDraggable(document.getElementById('joystick-drag-handle'), document.getElementById('touch-joystick'), 'joystickPos');
  makeControlDraggable(document.getElementById('actions-drag-handle'), document.getElementById('touch-actions'), 'actionsPos');
}

// Only transitions PLAYING -> PAUSED, never toggles back - safe to call from
// multiple listeners (blur, visibilitychange) that might both fire at once.
// Guest-safe: rather than pausing its own read-only shadow (which the real
// match on the host would know nothing about), a guest asks the host to
// pause instead - the host pausing is what actually stops the match for both.
function pauseGame() {
  if (G.online && G.online.role === 'guest') {
    if (G.state === STATE.PLAYING) sendOnlineMessage({ type: 'pauseToggle' });
    return;
  }
  if (G.state !== STATE.PLAYING) return;
  G.state = STATE.PAUSED;
  document.getElementById('pause-overlay').classList.remove('hidden');
  SFX.stopCrowdAmbience();
  if (G.online && G.online.role === 'host') sendOnlineMessage({ type: 'stateChange', state: STATE.PAUSED });
}

function togglePause() {
  // Same idea as pauseGame's guest branch, but for the toggle-back-to-playing
  // direction too - the guest always just asks the host to flip pause state,
  // never touches its own G.state directly.
  if (G.online && G.online.role === 'guest') {
    sendOnlineMessage({ type: 'pauseToggle' });
    return;
  }
  if (G.state === STATE.PLAYING) {
    pauseGame();
  } else if (G.state === STATE.PAUSED) {
    G.state = STATE.PLAYING;
    document.getElementById('pause-overlay').classList.add('hidden');
    SFX.startCrowdAmbience();
    if (G.online && G.online.role === 'host') sendOnlineMessage({ type: 'stateChange', state: STATE.PLAYING });
  }
}

// ============================================================
// Online multiplayer (WebRTC, room-code signaling relay)
// ============================================================
// The two browsers still connect directly over a WebRTC DataChannel (a
// free public STUN server just helps each side discover its own reachable
// address) - a small always-on relay (see relay-server/server.js, deployed
// on Glitch) only pairs the two players by a short room code and forwards
// their SDP offer/answer (gathered with non-trickle ICE, so each is a
// single one-shot blob rather than a back-and-forth of individual
// candidates) between them - see startOnlineHost/joinOnlineWithCode below.
// The relay never sees any match data and both sides disconnect from it
// the moment their real DataChannel opens. Trade-off, accepted: some
// strict/symmetric NAT pairs still won't connect directly (no TURN relay
// for that, which would need to relay actual game traffic, not just a
// one-time handshake).
//
// Architecture: host-authoritative, not lockstep. Whoever hosts keeps
// running the exact same simulation single-player already runs
// (update/initMatchWithClubs/AI/physics, untouched) - this avoids having
// to make the engine's heavy Math.random() use deterministic across two
// machines. The guest never runs update(dt); they only send input intents
// and render from snapshots the host streams back (see Phase 2+).
const ONLINE_ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
// A tiny always-on relay (see relay-server/server.js, deployed on Glitch)
// that does nothing but pair two players by a short room code and forward
// their WebRTC offer/answer between them - it never sees any match data,
// and both sides disconnect from it the moment their real peer-to-peer
// DataChannel opens (see wireOnlineDataChannel). Fill in your own deployed
// project's URL here (Render's dashboard URL for the service, with https -> wss).
const RELAY_SERVER_URL = 'wss://retro-ball-relay.onrender.com';
// Render's free tier sleeps after ~15 minutes idle and can take up to about
// a minute to wake back up on the next connection - long enough that a
// short timeout here would misreport a perfectly healthy but sleepy server
// as unreachable.
const SIGNAL_CONNECT_TIMEOUT_MS = 65000;

function setOnlineHostStatus(text) {
  const el = document.getElementById('online-host-status');
  if (el) el.textContent = text;
}
function setOnlineJoinStatus(text) {
  const el = document.getElementById('online-join-status');
  if (el) el.textContent = text;
}

// Selects a readonly/code textarea's full text and tries the classic
// execCommand copy path rather than the async Clipboard API - this game
// is opened straight from disk (file://), where navigator.clipboard.writeText
// often silently rejects due to the browser's secure-context/permissions
// policy. execCommand is deprecated but still works from a file:// page,
// and even if it fails the text is left selected for a manual Ctrl+C.
function copyTextFromBox(id) {
  const box = document.getElementById(id);
  box.select();
  box.setSelectionRange(0, box.value.length);
  try { document.execCommand('copy'); } catch (e) { /* clipboard unavailable - text is still selected */ }
}

// Resolves once ICE gathering finishes so pc.localDescription carries every
// discovered candidate baked into one SDP blob - simplest shape to relay in
// a single message rather than trickling individual candidates through the
// signaling server. STUN-reflexive candidates are usually gathered within a
// second or two; the timeout is a "send it anyway" fallback for the rare
// case gathering stalls, rather than an infinite spinner.
function waitForIceGatheringComplete(pc, timeoutMs = 10000) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise(resolve => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    };
    const check = () => { if (pc.iceGatheringState === 'complete') finish(); };
    pc.addEventListener('icegatheringstatechange', check);
    setTimeout(finish, timeoutMs);
  });
}

// Shared connect logic for both the host and guest sides of the signaling
// handshake - opens a WebSocket to the relay server with a "don't hang
// forever if it's asleep/unreachable" timeout, since Glitch's free tier
// sleeps after a few minutes idle. Returns the WebSocket immediately (so the
// caller can stash it on G.online right away); onOpen/onMessage/onClose/
// onTimeout are called as those events happen.
function openSignalingSocket({ onOpen, onMessage, onClose, onTimeout }) {
  const ws = new WebSocket(RELAY_SERVER_URL);
  let settled = false;
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    onTimeout();
    try { ws.close(); } catch (e) { /* already closing */ }
  }, SIGNAL_CONNECT_TIMEOUT_MS);
  ws.onopen = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    onOpen();
  };
  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch (err) { return; }
    onMessage(msg);
  };
  ws.onclose = () => {
    clearTimeout(timer);
    if (!settled) { settled = true; onTimeout(); return; } // closed/errored before ever opening
    onClose();
  };
  return ws;
}

function teardownOnline() {
  if (G.online) {
    try { G.online.signalWs && G.online.signalWs.close(); } catch (e) { /* already closed */ }
    try { G.online.dc && G.online.dc.close(); } catch (e) { /* already closed */ }
    try { G.online.pc && G.online.pc.close(); } catch (e) { /* already closed */ }
  }
  G.online = null;
}

// Shown for a mid-match connection loss - not shown for a deliberate local
// quit, since teardownOnline() (called by goToMainMenu) already nulls
// G.online synchronously before either of this overlay's two triggers
// (onconnectionstatechange/dc.onclose) ever get a chance to fire.
function showConnectionLostOverlay() {
  if (G.state === STATE.MENU) return; // not even in a match/setup flow - nothing to show over
  document.getElementById('online-lost-overlay').classList.remove('hidden');
}

function wireOnlinePeerConnection(pc) {
  pc.onconnectionstatechange = () => {
    if (!G.online || G.online.pc !== pc) return;
    G.online.connState = pc.connectionState;
    console.log('[online] connection state:', pc.connectionState);
    if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
      // A P2P failure this early (before the DataChannel ever opens) means
      // wireOnlineDataChannel's own signalWs cleanup never runs - close it
      // here too, or the socket to the relay leaks open indefinitely.
      try { G.online.signalWs && G.online.signalWs.close(); } catch (e) { /* already closed */ }
      const msg = "Connection failed - this can happen with strict/symmetric NAT or firewalls; there's no TURN relay to fall back on in this version. If it keeps failing, try having one of you switch to a mobile hotspot.";
      if (G.online.role === 'host') setOnlineHostStatus(msg); else setOnlineJoinStatus(msg);
      if (G.online.matchStarted) showConnectionLostOverlay();
    }
  };
}

function sendOnlineMessage(msg) {
  if (!G.online || !G.online.dc || G.online.dc.readyState !== 'open') return;
  G.online.dc.send(JSON.stringify(msg));
}

// The 'ping'/'ping-ack' pair (logged to console) just proves the channel
// actually works end to end; real match messages are dispatched to
// hostHandleMessage/guestHandleMessage below.
function wireOnlineDataChannel(dc) {
  dc.onopen = () => {
    if (!G.online) return;
    G.online.connState = 'open';
    console.log('[online] data channel open, role=' + G.online.role);
    // The relay's only job was introducing the two peers - now that the
    // real, direct DataChannel is open, it's no longer needed.
    try { G.online.signalWs && G.online.signalWs.close(); } catch (e) { /* already closed */ }
    G.online.signalWs = null;
    if (G.online.role === 'host') {
      setOnlineHostStatus('Connected!');
      sendOnlineMessage({ type: 'ping' });
    } else {
      setOnlineJoinStatus('Connected!');
    }
    populateOnlineTeamPickScreen();
    showScreen('online-teampick-screen');
  };
  dc.onclose = () => {
    console.log('[online] data channel closed');
    if (!G.online) return; // we closed it ourselves (e.g. quit to menu) - nothing to show
    showConnectionLostOverlay();
  };
  dc.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch (err) { return; }
    if (msg.type === 'ping') { console.log('[online] ping received, replying'); sendOnlineMessage({ type: 'ping-ack' }); return; }
    if (msg.type === 'ping-ack') { console.log('[online] ping round-trip confirmed - connection works'); return; }
    if (!G.online) return;
    if (G.online.role === 'host') hostHandleMessage(msg);
    else guestHandleMessage(msg);
  };
}

// Dispatches every message the guest can send. 'move' is continuous (just
// updates G.remoteInput.move for applyGuestMoveInput to read each tick);
// the rest are discrete button-edge events resolved immediately against
// G.controlled2/team 1, mirroring the equivalent local-input functions.
function hostHandleMessage(msg) {
  if (msg.type === 'teamPick') {
    onlineRemoteTeamDef = msg.teamDef;
    onlineRemoteLineup = msg.lineup;
    if (onlineLocalReady) {
      startOnlineHostedMatch(onlineTeamPickList()[onlineTeamPick.clubIdx], onlineRemoteTeamDef, onlineRemoteLineup);
    } else {
      setOnlineTeamPickStatus("Your friend is ready! Pick your team, half length and skill, then hit Ready.");
    }
  } else if (msg.type === 'move') {
    G.remoteInput.move.x = msg.x;
    G.remoteInput.move.y = msg.y;
  } else if (msg.type === 'tackle') {
    tryRemoteTackle();
  } else if (msg.type === 'switch') {
    tryRemoteSwitchPlayer();
  } else if (msg.type === 'run') {
    callTeammateRun(G.controlled2);
  } else if (msg.type === 'chargeRelease') {
    onRemoteChargeRelease(msg.kind, msg.power, msg.aim);
  } else if (msg.type === 'pauseToggle') {
    // Calls the host's OWN togglePause (this function only ever runs on the
    // host, so its role-check there takes the real pause/resume branch,
    // whichever the current G.state calls for) - same effect as if the host
    // had pressed Pause themselves, just triggered by the guest instead.
    togglePause();
  } else if (msg.type === 'endHalftimeRequest') {
    endHalftime(); // same "call the host's own version" trick as pauseToggle above
  }
}

// Guest side: 'matchStart' arrives once when the host kicks off a match -
// build the exact same local team/kit/DOM setup the host just built (same
// deterministic inputs, same buildTeam/kitsClash logic - only the players'
// cosmetic random attributes like skin/hair tone differ between the two
// screens, which is invisible during play). 'snapshot' arrivals are buffered
// for interpolateShadowState() to lerp between, not applied immediately -
// see applySnapshot.
function guestHandleMessage(msg) {
  if (msg.type === 'matchStart') {
    G.online.matchStarted = true;
    G.online.snapshotBuf = [null, null];
    initMatchWithClubs(msg.homeDef, msg.oppDef, msg.halfLenMin, msg.skillKey);
    // initMatchWithClubs just rolled its OWN random weather/night-match for
    // this shadow match - override with whatever the host actually rolled,
    // so both screens show the same conditions instead of disagreeing.
    G.isNightMatch = msg.isNightMatch;
    rollWeather(msg.weather);
    // Substitutions are a host-only decision (they act on G.teams[0]'s real
    // bench) - hide the button entirely for the guest rather than leave a
    // control that would silently do the wrong thing for them.
    document.getElementById('btn-subs').classList.add('hidden');
    document.getElementById('btn-subs-halftime').classList.add('hidden');
    showScreen('match-screen');
  } else if (msg.type === 'snapshot') {
    applySnapshot(msg);
  } else if (msg.type === 'stateChange') {
    applyGuestStateChange(msg.state, msg.extra);
  } else if (msg.type === 'toast') {
    showToast(msg.text, msg.color);
  } else if (msg.type === 'event') {
    logMatchEvent(msg.text);
  }
}

// Mirrors whatever real state transition just happened on the host
// (pauseGame/togglePause/scoreGoal/enterHalftime/endHalftime/finalizeFulltime)
// - the guest never runs any of those functions itself, it only ever reflects
// what the host already decided and broadcast. Hides every state-specific
// overlay first, then shows the one (if any) that applies to the new state.
const STATE_OVERLAY_ID = { PAUSED: 'pause-overlay', GOAL: 'goal-banner', HALFTIME: 'halftime-overlay', FULLTIME: 'fulltime-overlay' };
function applyGuestStateChange(state, extra) {
  if (G.replay.active && state !== STATE.GOAL) endGoalReplay(); // safety net if a slow frame rate left the clip still playing
  if (G.halftimeInterval) { clearInterval(G.halftimeInterval); G.halftimeInterval = null; }
  if (G.fulltimeTimeout) { clearTimeout(G.fulltimeTimeout); G.fulltimeTimeout = null; }
  G.state = state;
  Object.values(STATE_OVERLAY_ID).forEach(id => document.getElementById(id).classList.add('hidden'));
  const overlayId = STATE_OVERLAY_ID[state];
  // GOAL is special-cased below - the banner is a full-screen dark overlay
  // that would hide the replay clip, so it stays hidden here and is only
  // revealed once the clip finishes (or immediately if none started).
  if (overlayId && state !== STATE.GOAL) document.getElementById(overlayId).classList.remove('hidden');
  if (state === STATE.GOAL && extra) {
    document.getElementById('goal-banner-text').textContent = extra.text;
    document.getElementById('goal-banner').style.setProperty('--team-color', extra.teamColor);
    SFX.goal();
    vibrate([80, 40, 80]);
    G.confettiTimeouts.forEach(clearTimeout);
    G.confettiTimeouts = [];
    launchConfetti(extra.teamColor);
    const revealGoalBanner = () => document.getElementById('goal-banner').classList.remove('hidden');
    if (!startGoalReplay(revealGoalBanner)) revealGoalBanner();
  } else if (state === STATE.HALFTIME) {
    startGuestHalftimeCountdown();
  } else if (state === STATE.FULLTIME && extra) {
    document.getElementById('fulltime-score').textContent = extra.scoreText;
    document.getElementById('fulltime-stats').innerHTML = extra.statsHtml;
    document.getElementById('fulltime-achievements').innerHTML = extra.achievementsHtml;
    document.getElementById('fulltime-motm').textContent = extra.motmText;
    document.getElementById('fulltime-motm').classList.toggle('hidden', !extra.motmVisible);
    document.getElementById('btn-rematch').classList.add('hidden');
    document.getElementById('btn-continue-season').classList.add('hidden');
    document.getElementById('btn-continue-cup').classList.add('hidden');
    document.getElementById('btn-continue-career').classList.add('hidden');
    // SEASON/CUP/CAREER are always null during an online match (quick-match
    // only, v1 scope), so the host's own finalizeFulltime always takes its
    // plain 12s-then-menu path - mirror that same timing here independently
    // rather than needing the host to explicitly tell us when to leave.
    G.fulltimeTimeout = setTimeout(() => goToMainMenu(), 12000);
  }
  if (state === STATE.PLAYING) SFX.startCrowdAmbience();
  else SFX.stopCrowdAmbience();
}

// Cosmetic only - no authority over when halftime actually ends (that's
// still entirely the host's call, mirrored back via a later 'stateChange').
// Just gives the guest something sensible to look at instead of a frozen
// "30" the whole break.
function startGuestHalftimeCountdown() {
  let remaining = 30;
  document.getElementById('halftime-timer').textContent = remaining;
  G.halftimeInterval = setInterval(() => {
    remaining--;
    document.getElementById('halftime-timer').textContent = Math.max(remaining, 0);
    if (remaining <= 0) { clearInterval(G.halftimeInterval); G.halftimeInterval = null; }
  }, 1000);
}

// Throttled well below the 60fps sim rate (see SNAPSHOT_INTERVAL_MS) - only
// positions/score/clock/state travel every tick; static attributes (name,
// kit colour, attributes) already went over once in 'matchStart'.
const SNAPSHOT_INTERVAL_MS = 40; // ~25Hz
function buildSnapshot() {
  const players = [];
  for (const team of G.teams) {
    for (const p of team.players) {
      players.push({
        idx: p.idx, team: p.__team,
        x: Math.round(p.pos.x * 100) / 100, y: Math.round(p.pos.y * 100) / 100,
        cardLevel: p.cardLevel, sentOff: p.sentOff,
      });
    }
  }
  return {
    type: 'snapshot',
    half: G.half, elapsedSec: Math.round(G.elapsedSec),
    score: [G.teams[0].score, G.teams[1].score],
    ball: {
      x: Math.round(G.ball.pos.x * 100) / 100, y: Math.round(G.ball.pos.y * 100) / 100,
      vx: Math.round(G.ball.vel.x * 100) / 100, vy: Math.round(G.ball.vel.y * 100) / 100,
    },
    // Sent separately (not just "whoever's controlled") since the GUEST's
    // own screen needs to know about team 1's controlled player (G.controlled2)
    // specifically, not the host's own (team 0) - see interpolateShadowState.
    controlledIdx0: G.controlled ? G.controlled.idx : null,
    controlledIdx1: G.controlled2 ? G.controlled2.idx : null,
    // Lets the guest's shadow know a restart is in progress and who's taking
    // it, purely so isAimableShotSituation()/drawAimMarker (already generic)
    // can work correctly for the guest too - see guestSteerAim.
    restart: G.restart ? { takerTeam: G.restart.taker.__team, takerIdx: G.restart.taker.idx, kind: G.restart.kind } : null,
    players,
  };
}
function maybeBroadcastSnapshot() {
  if (!(G.online && G.online.role === 'host' && G.online.dc && G.online.dc.readyState === 'open')) return;
  const now = performance.now();
  if (now - (G.online.lastBroadcastAt || 0) < SNAPSHOT_INTERVAL_MS) return;
  G.online.lastBroadcastAt = now;
  sendOnlineMessage(buildSnapshot());
}

function applySnapshot(snap) {
  if (!G.online) return;
  const buf = G.online.snapshotBuf;
  buf[0] = buf[1] || { data: snap, recvAt: performance.now() }; // first snapshot ever - nothing to lerp from yet
  buf[1] = { data: snap, recvAt: performance.now() };
}
function snapshotPlayerMap(snap) {
  const map = {};
  for (const p of snap.players) map[p.team + '_' + p.idx] = p;
  return map;
}
// Called every guest rAF frame (in place of update(dt)) - lerps the shadow
// G.teams/G.ball toward the most recent snapshot over the time since it
// arrived, rather than snapping positions in discrete ~25Hz steps.
function interpolateShadowState(dt) {
  if (G.replay.active) return; // don't fight the goal-replay clip's own position writes
  const buf = G.online && G.online.snapshotBuf;
  if (!buf || !buf[1]) return;
  const from = buf[0].data, to = buf[1].data;
  const t = clamp((performance.now() - buf[1].recvAt) / SNAPSHOT_INTERVAL_MS, 0, 1);
  const fromMap = snapshotPlayerMap(from), toMap = snapshotPlayerMap(to);
  for (const team of G.teams) {
    for (const p of team.players) {
      const key = p.__team + '_' + p.idx;
      const tp = toMap[key];
      if (!tp) continue;
      const fp = fromMap[key] || tp;
      p.pos.x = lerp(fp.x, tp.x, t);
      p.pos.y = lerp(fp.y, tp.y, t);
      p.cardLevel = tp.cardLevel;
      p.sentOff = tp.sentOff;
    }
  }
  G.ball.pos.x = lerp(from.ball.x, to.ball.x, t);
  G.ball.pos.y = lerp(from.ball.y, to.ball.y, t);
  G.ball.vel.x = to.ball.vx;
  G.ball.vel.y = to.ball.vy;
  G.half = to.half;
  G.elapsedSec = to.elapsedSec;
  if (G.teams[0].score !== to.score[0]) { G.teams[0].score = to.score[0]; document.getElementById('score-home').textContent = to.score[0]; }
  if (G.teams[1].score !== to.score[1]) { G.teams[1].score = to.score[1]; document.getElementById('score-away').textContent = to.score[1]; }
  // The GUEST's own "my player" is team 1's controlled2 on the host, NOT
  // the host's own G.controlled (team 0) - repointing G.controlled here to
  // team 1 is what makes the camera/radar-highlight/stamina-bar/tackle-range
  // (all of which already read G.controlled generically) correctly follow
  // the guest's own player instead of the host's.
  if (to.controlledIdx1 != null) {
    const cp = G.teams[1].players.find(p => p.idx === to.controlledIdx1);
    if (cp) G.controlled = cp;
  }
  // Minimal mirror of the host's real G.restart - just enough for the
  // already-generic isAimableShotSituation()/drawAimMarker to recognise
  // "it's my dead ball right now" without any changes to either of them.
  if (to.restart) {
    const taker = G.teams[to.restart.takerTeam] && G.teams[to.restart.takerTeam].players.find(p => p.idx === to.restart.takerIdx);
    G.restart = taker ? { taker, kind: to.restart.kind } : null;
  } else {
    G.restart = null;
  }
  // Cosmetic dead-reckoning for the guest's OWN player only - nudges it a
  // little further in the direction it's currently sending, on top of the
  // lerp toward the last snapshot, so movement feels responsive despite the
  // round-trip latency. The next snapshot always overwrites this - nothing
  // here needs reconciling, it's purely a visual guess.
  if (G.controlled && dt) {
    const mv = G.lastGuestMove;
    const pushAmount = clamp(Math.hypot(mv.x, mv.y), 0, 1);
    if (pushAmount > 0.05) {
      const dir = norm(mv);
      const speed = HUMAN_SPEED * G.controlled.pace * pushAmount * 0.6; // damped - a guess, not the real sim
      G.controlled.pos.x += dir.x * speed * dt;
      G.controlled.pos.y += dir.y * speed * dt;
      clampToPitch(G.controlled.pos);
    }
  }
  recordReplayFrame();
}

// Guest-only: reads the same local joystick/keys handleHumanMovement would,
// but instead of moving a local player, sends the resulting vector to the
// host every frame - the host is what actually simulates the movement (see
// applyGuestMoveInput). Cheap enough (a couple of small numbers) to just
// send unthrottled rather than adding a separate send-rate timer.
function sendGuestMoveInput() {
  if (G.state !== STATE.PLAYING) return;
  let mx = 0, my = 0;
  if (G.keysDown[KEYS.up]) my -= 1;
  if (G.keysDown[KEYS.down]) my += 1;
  if (G.keysDown[KEYS.left]) mx -= 1;
  if (G.keysDown[KEYS.right]) mx += 1;
  mx += G.joystick.x;
  my += G.joystick.y;
  G.lastGuestMove.x = mx;
  G.lastGuestMove.y = my;
  sendOnlineMessage({ type: 'move', x: mx, y: my });
}

// Guest-only: mirrors the aim-steering branch of handleHumanMovement (never
// the movement branch - the guest's own player is driven entirely by the
// host via snapshots/interpolateShadowState, this only ever touches
// G.shotAim, purely for a responsive-feeling reticle while charging a
// steerable dead ball). Works correctly as soon as G.restart is mirrored
// (see interpolateShadowState) since isAimableShotSituation/drawAimMarker
// are already generic and need no changes of their own.
function guestSteerAim(dt) {
  if (!G.controlled || !G.charge.shoot || !isAimableShotSituation(G.controlled)) return;
  let steer = G.joystick.x;
  if (G.keysDown[KEYS.left]) steer -= 1;
  if (G.keysDown[KEYS.right]) steer += 1;
  G.shotAim = clamp(G.shotAim + steer * dt * 1.2, -1, 1);
}

// ---------- Online team-pick screen ----------
// Each side independently picks its own league + club (any of ALL_CLUBS,
// same pool Career mode draws from - see onlineTeamPickList, which mirrors
// careerClubSetupList's "filter by currently-selected league" approach).
// The host additionally picks half-length (shared, since it governs both
// sides' AI teammates), so that control is simply hidden on the guest's
// copy (see populateOnlineTeamPickScreen). There's no skill/difficulty
// picker here at all - this is a human-vs-human match, not vs AI, so it's
// just fixed at ONLINE_DEFAULT_SKILL rather than cluttering the screen with
// a control that only affects AI teammates' behaviour. Only the guest's
// pick travels over the network (as 'teamPick') - the host's pick only
// needs to reach the guest once, bundled into 'matchStart' when the match
// actually begins, so there's no need for a symmetrical "host ready" message.
const ONLINE_DEFAULT_SKILL = 'medium';
const onlineTeamPick = { leagueIdx: 0, clubIdx: 0, halfIdx: 1 };
let onlineLocalReady = false;
let onlineRemoteTeamDef = null; // guest's picked club, once the host receives it

function setOnlineTeamPickStatus(text) {
  const el = document.getElementById('online-teampick-status');
  if (el) el.textContent = text;
}
// clubIdx is an index into THIS filtered list, not directly into ALL_CLUBS -
// resolved to a real club object only when actually needed (rendering, or
// starting/sending the pick) - same convention as careerClubSetupList.
function onlineTeamPickList() {
  return ALL_CLUBS.filter(c => c.league === CAREER_LEAGUES[onlineTeamPick.leagueIdx]);
}
function renderOnlineTeamPickLeague() {
  document.getElementById('online-league-label').textContent = CAREER_LEAGUES[onlineTeamPick.leagueIdx];
}
function cycleOnlineTeamPickLeague(dir) {
  onlineTeamPick.leagueIdx = (onlineTeamPick.leagueIdx + dir + CAREER_LEAGUES.length) % CAREER_LEAGUES.length;
  onlineTeamPick.clubIdx = 0;
  renderOnlineTeamPickLeague();
  renderOnlineTeamPickTeam();
}
function renderOnlineTeamPickTeam() {
  const def = onlineTeamPickList()[onlineTeamPick.clubIdx];
  const box = document.getElementById('online-team-box');
  box.style.setProperty('--team-color', def.shirt);
  box.style.setProperty('--team-text', readableTextColor(def.shirt));
  document.getElementById('online-team-name').textContent = def.name;
}
function cycleOnlineTeamPickTeam(dir) {
  const list = onlineTeamPickList();
  onlineTeamPick.clubIdx = (onlineTeamPick.clubIdx + dir + list.length) % list.length;
  renderOnlineTeamPickTeam();
}
function renderOnlineTeamPickHalf() {
  document.getElementById('online-half-label').textContent = HALF_LENGTH_OPTIONS[onlineTeamPick.halfIdx] + ' min';
}
function cycleOnlineTeamPickHalf(dir) {
  onlineTeamPick.halfIdx = (onlineTeamPick.halfIdx + dir + HALF_LENGTH_OPTIONS.length) % HALF_LENGTH_OPTIONS.length;
  renderOnlineTeamPickHalf();
}
// Your own throwaway starting-XI/formation customisation for whichever club
// you've currently got picked - built lazily the first time you open the
// Squad screen, and rebuilt if you switch clubs (a different club's real
// squad is a completely different set of players). Nothing here is saved
// to localStorage - it only needs to survive until the match actually
// starts, at which point it's applied directly via applyCareerSquad.
let onlineLineupCtx = null;
let onlineRemoteLineup = null; // host-only: the guest's own lineup ctx, once their 'teamPick' arrives
function buildOnlineLineupContext(clubIdx) {
  return { clubIdx, squad: generateInitialCareerSquad(ALL_CLUBS[clubIdx]), formationKey: '4-3-3', customLineup: {} };
}
function ensureOnlineLineupCtx(clubIdx) {
  if (!onlineLineupCtx || onlineLineupCtx.clubIdx !== clubIdx) onlineLineupCtx = buildOnlineLineupContext(clubIdx);
  return onlineLineupCtx;
}
function populateOnlineTeamPickScreen() {
  const isHost = !!(G.online && G.online.role === 'host');
  document.getElementById('online-half-box').classList.toggle('hidden', !isHost);
  onlineTeamPick.leagueIdx = 0;
  onlineTeamPick.clubIdx = 0;
  onlineTeamPick.halfIdx = 1;
  onlineLocalReady = false;
  onlineRemoteTeamDef = null;
  onlineLineupCtx = null;
  onlineRemoteLineup = null;
  document.getElementById('btn-online-ready').disabled = false;
  document.getElementById('online-league-prev').disabled = false;
  document.getElementById('online-league-next').disabled = false;
  document.getElementById('online-team-prev').disabled = false;
  document.getElementById('online-team-next').disabled = false;
  setOnlineTeamPickStatus('');
  renderOnlineTeamPickLeague();
  renderOnlineTeamPickTeam();
  if (isHost) renderOnlineTeamPickHalf();
}
// Host-only: actually starts the match once both sides' team picks are
// known (called either immediately, if the guest's pick already arrived
// by the time the host hits Ready, or from hostHandleMessage's 'teamPick'
// branch otherwise). Team 0 is always the host, team 1 always the guest,
// matching every other place in this codebase that assumes team 0 = human.
// Each side's own lineup customisation (if any) is applied on top of the
// default team buildTeam already built - if a side never opened the Squad
// screen, a fresh default context is built on the spot instead, giving the
// same sensible auto-picked XI Career mode falls back to for an untouched squad.
function startOnlineHostedMatch(hostTeamDef, guestTeamDef, guestLineup) {
  initMatchWithClubs(hostTeamDef, guestTeamDef, HALF_LENGTH_OPTIONS[onlineTeamPick.halfIdx], ONLINE_DEFAULT_SKILL);
  // guestTeamDef arrived over the network (JSON round-tripped), so it's a
  // fresh object, never the same reference as anything in ALL_CLUBS -
  // ALL_CLUBS.indexOf(guestTeamDef) would always miss. Match by name instead.
  const hostClubIdx = ALL_CLUBS.findIndex(c => c.name === hostTeamDef.name);
  applyCareerSquad(G.teams[0], ensureOnlineLineupCtx(hostClubIdx));
  const guestClubIdx = ALL_CLUBS.findIndex(c => c.name === guestTeamDef.name);
  // If the guest customised a lineup for a different club than the one they
  // actually picked (e.g. changed their team after visiting Squad), that
  // lineup is stale - fall back to a fresh default for their real club
  // rather than applying the wrong squad.
  const validGuestLineup = (guestLineup && guestLineup.clubIdx === guestClubIdx) ? guestLineup : null;
  applyCareerSquad(G.teams[1], validGuestLineup || buildOnlineLineupContext(guestClubIdx));
  showScreen('match-screen');
}
function onlineReadyClicked() {
  if (!G.online || onlineLocalReady) return;
  onlineLocalReady = true;
  document.getElementById('btn-online-ready').disabled = true;
  const myTeamDef = onlineTeamPickList()[onlineTeamPick.clubIdx];
  if (G.online.role === 'guest') {
    document.getElementById('online-league-prev').disabled = true;
    document.getElementById('online-league-next').disabled = true;
    document.getElementById('online-team-prev').disabled = true;
    document.getElementById('online-team-next').disabled = true;
    sendOnlineMessage({ type: 'teamPick', teamDef: myTeamDef, lineup: onlineLineupCtx });
    setOnlineTeamPickStatus('Waiting for the host to start the match...');
  } else if (onlineRemoteTeamDef) {
    startOnlineHostedMatch(myTeamDef, onlineRemoteTeamDef, onlineRemoteLineup);
  } else {
    setOnlineTeamPickStatus("Waiting for your friend to pick their team...");
  }
}

function sendSignal(msg) {
  if (!G.online || !G.online.signalWs || G.online.signalWs.readyState !== WebSocket.OPEN) return;
  G.online.signalWs.send(JSON.stringify(msg));
}

function startOnlineHost() {
  teardownOnline();
  const pc = new RTCPeerConnection({ iceServers: ONLINE_ICE_SERVERS });
  const dc = pc.createDataChannel('match');
  G.online = { role: 'host', pc, dc, signalWs: null, roomCode: null, connState: 'connecting', matchStarted: false, snapshotBuf: [null, null], lastBroadcastAt: 0 };
  wireOnlineDataChannel(dc);
  wireOnlinePeerConnection(pc);
  setOnlineHostStatus('Connecting to the server... can take up to a minute if it was asleep.');

  // Build the offer eagerly, in parallel with connecting to the relay - ICE
  // gathering only probes our own address via STUN and costs nothing if no
  // one ever joins, so there's no reason to make the guest wait for it
  // after they've already joined.
  const offerReady = (async () => {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGatheringComplete(pc);
  })();

  G.online.signalWs = openSignalingSocket({
    onOpen: () => sendSignal({ type: 'create' }),
    onMessage: async (msg) => {
      if (!G.online) return;
      if (msg.type === 'created') {
        G.online.roomCode = msg.code;
        document.getElementById('online-host-code').value = msg.code;
        setOnlineHostStatus(`Waiting for your friend to join with code ${msg.code}...`);
      } else if (msg.type === 'peer-joined') {
        setOnlineHostStatus('Your friend just joined - connecting...');
        try {
          await offerReady;
          sendSignal({ type: 'relay', payload: { sdp: pc.localDescription } });
        } catch (e) {
          setOnlineHostStatus("Couldn't finish connecting - check your network and try again.");
        }
      } else if (msg.type === 'relay') {
        try {
          await pc.setRemoteDescription(msg.payload.sdp);
          setOnlineHostStatus('Connecting...');
        } catch (e) {
          setOnlineHostStatus("Couldn't finish connecting - check your network and try again.");
        }
      } else if (msg.type === 'peer-left') {
        setOnlineHostStatus('Your friend disconnected before the game could start.');
      }
    },
    onClose: () => { /* either the DataChannel already took over, or the room's just gone - nothing to do */ },
    onTimeout: () => setOnlineHostStatus("Couldn't reach the server - check your connection and try again."),
  });
}

function joinOnlineWithCode() {
  const code = document.getElementById('online-join-code-input').value.trim().toUpperCase();
  if (!code) { setOnlineJoinStatus('Type the code your friend sent you first.'); return; }
  teardownOnline();
  G.online = { role: 'guest', pc: null, dc: null, signalWs: null, connState: 'connecting', matchStarted: false, snapshotBuf: [null, null], lastBroadcastAt: 0 };
  setOnlineJoinStatus('Connecting to the server... can take up to a minute if it was asleep.');
  G.online.signalWs = openSignalingSocket({
    onOpen: () => sendSignal({ type: 'join', code }),
    onMessage: async (msg) => {
      if (!G.online) return;
      if (msg.type === 'not-found') {
        setOnlineJoinStatus("That code wasn't found - check it and try again.");
        teardownOnline();
      } else if (msg.type === 'joined') {
        setOnlineJoinStatus('Connected to host, waiting for their game info...');
      } else if (msg.type === 'relay') {
        // The one and only 'relay' message a guest ever receives before its
        // own DataChannel opens is the host's offer.
        try {
          const pc = new RTCPeerConnection({ iceServers: ONLINE_ICE_SERVERS });
          G.online.pc = pc;
          pc.ondatachannel = (e) => { G.online.dc = e.channel; wireOnlineDataChannel(e.channel); };
          wireOnlinePeerConnection(pc);
          await pc.setRemoteDescription(msg.payload.sdp);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await waitForIceGatheringComplete(pc);
          sendSignal({ type: 'relay', payload: { sdp: pc.localDescription } });
          setOnlineJoinStatus('Connecting...');
        } catch (e) {
          setOnlineJoinStatus("Couldn't finish connecting - check your network and try again.");
        }
      } else if (msg.type === 'peer-left') {
        setOnlineJoinStatus('The host disconnected.');
      }
    },
    onClose: () => { /* either the DataChannel already took over, or the host's gone - nothing to do */ },
    onTimeout: () => setOnlineJoinStatus("Couldn't reach the server - check your connection and try again."),
  });
}
