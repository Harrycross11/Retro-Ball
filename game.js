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
const SIX_YARD_DEPTH = 5.5;
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
  { name: 'Crystal Palace', shirt: '#C4122E', shorts: '#1B458F', stripe: '#1B458F', strength: 1.01, press: 'low', away: { shirt: '#111111', shorts: '#111111' },
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
  { name: 'Newcastle United', shirt: '#241F20', shorts: '#241F20', stripe: '#FFFFFF', strength: 1.08, press: 'high', away: { shirt: '#5B2A86', shorts: '#FFFFFF' },
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
  { name: 'Sunderland', shirt: '#EB172B', shorts: '#000000', stripe: '#FFFFFF', strength: 0.86, press: 'low', away: { shirt: '#FFFFFF', shorts: '#1B1464' },
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
  { name: 'Southampton', shirt: '#D71920', shorts: '#000000', stripe: '#FFFFFF', strength: 1.03, press: 'high', squad: {
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
  { name: 'West Bromwich Albion', shirt: '#122F67', shorts: '#FFFFFF', stripe: '#FFFFFF', strength: 0.95, press: 'mid', squad: {
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
  { name: 'Sheffield United', shirt: '#EE2737', shorts: '#000000', stripe: '#FFFFFF', strength: 0.97, press: 'high', squad: {
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
  { name: 'Stoke City', shirt: '#E03A3E', shorts: '#FFFFFF', stripe: '#FFFFFF', strength: 0.92, press: 'mid', squad: {
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
  { name: 'Juventus', shirt: '#FFFFFF', shorts: '#000000', stripe: '#000000', strength: 1.10, press: 'mid', squad: {
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
  { name: 'Inter Milan', shirt: '#0C4396', shorts: '#000000', stripe: '#000000', strength: 1.14, press: 'high', squad: {
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
  { name: 'Athletic Bilbao', shirt: '#EE2523', shorts: '#FFFFFF', stripe: '#FFFFFF', strength: 1.00, press: 'high', squad: {
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
  { name: 'Real Betis', shirt: '#00A650', shorts: '#FFFFFF', stripe: '#FFFFFF', strength: 0.97, press: 'mid', squad: {
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
  { name: 'Espanyol', shirt: '#003DA5', shorts: '#FFFFFF', stripe: '#FFFFFF', strength: 0.87, press: 'mid', squad: {
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
// used only by Career mode (Play/Season/Cup keep indexing TEAMS
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
// Short codes for the compact league switcher on the team-pick boxes (see
// .team-box-league) - the full name doesn't fit at a size worth actually
// reading, so this is what's shown there instead; the full name is still
// available as a tooltip.
const LEAGUE_ABBR = {
  'Premier League': 'PL',
  'EFL Championship': 'CHA',
  'La Liga': 'LIGA',
  'Ligue 1': 'L1',
  'Bundesliga': 'BUN',
  'Serie A': 'SA',
};

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
// grandmaster/legend/mythic/invincible are four brand new tiers added above
// the old ceiling (champion), for 8 selectable ranks total (Bronze through
// Invincible) - see the rank-tile data-skill attributes in index.html.
const SKILLS = {
  easy:      { speed: 4.4, pressBoost: 1.08, tackleChance: 0.40, noise: 3.0,  reassessMin: 0.70, reassessMax: 1.40, shootRange: 16 },
  medium:    { speed: 5.0, pressBoost: 1.10, tackleChance: 0.52, noise: 1.6,  reassessMin: 0.50, reassessMax: 1.00, shootRange: 20 },
  hard:      { speed: 5.6, pressBoost: 1.10, tackleChance: 0.62, noise: 0.6,  reassessMin: 0.30, reassessMax: 0.70, shootRange: 26 },
  expert:    { speed: 6.0, pressBoost: 1.12, tackleChance: 0.70, noise: 0.3,  reassessMin: 0.22, reassessMax: 0.50, shootRange: 30 },
  legendary: { speed: 6.4, pressBoost: 1.15, tackleChance: 0.76, noise: 0.15, reassessMin: 0.16, reassessMax: 0.35, shootRange: 34 },
  champion:  { speed: 6.6, pressBoost: 1.18, tackleChance: 0.80, noise: 0.08, reassessMin: 0.12, reassessMax: 0.28, shootRange: 36 },
  grandmaster: { speed: 6.8, pressBoost: 1.20, tackleChance: 0.84, noise: 0.05, reassessMin: 0.09, reassessMax: 0.22, shootRange: 38 },
  legend:      { speed: 7.0, pressBoost: 1.22, tackleChance: 0.87, noise: 0.03, reassessMin: 0.07, reassessMax: 0.18, shootRange: 40 },
  // Two extra tiers above the old ceiling (legend/"Champion" tile) - internal
  // keys avoid "legendary" since that name is already taken by the Gold tile.
  mythic:      { speed: 7.15, pressBoost: 1.24, tackleChance: 0.90, noise: 0.02, reassessMin: 0.05, reassessMax: 0.14, shootRange: 43 },
  invincible:  { speed: 7.3, pressBoost: 1.26, tackleChance: 0.93, noise: 0.01, reassessMin: 0.04, reassessMax: 0.11, shootRange: 46 },
};
const HUMAN_SPEED = 6.2;
// How fast a player's actual velocity can change (m/s^2) - both speeding up
// and braking are eased through this rather than snapping straight to the
// target speed, so studs have to overcome inertia/grip on the turf like a
// real sprint or stop would, instead of teleporting to a new velocity.
const PLAYER_ACCEL = 26;
const TACKLE_RADIUS = 1.6;
// Minimum distance (metres) kept between any two players' centres - stops
// bodies stacking on top of each other. Smaller than TACKLE_RADIUS so a
// tackle can still trigger before the shove keeps them apart.
const PLAYER_MIN_SEP = 1.05;
// Was 0.9 - a pressing defender that's actually caught up to the ball
// carrier should get another go at it quickly, not stand there marking
// time for most of a second while the human just keeps dribbling.
const TACKLE_RETRY_SEC = 0.6;
const PICKUP_RADIUS = 1.1;
// A generous "reception magnet" radius for whichever player a pass was
// actually aimed at (see releasePass/checkPickup) - now that passes carry
// real speed (see PASS_MIN_ARRIVAL_SPEED), a small directional miss (skill
// wobble, or the receiver having drifted slightly since the ball was
// kicked) used to send it sailing well past them uncollected instead of
// being trapped. Only the intended receiver gets the bigger radius -
// everyone else (an interceptor reading the pass) still uses PICKUP_RADIUS.
const PASS_RECEPTION_RADIUS = 2.2;
const HUMAN_TACKLE_CHANCE = 0.65;
// PASS_MIN_SPEED was 9 - even a bare tap felt soft, so a short pass barely
// crept up to a nearby teammate rather than actually arriving with any
// real pace.
const PASS_MIN_SPEED = 13, PASS_MAX_SPEED = 23;
// Ball deceleration under normal pitch friction (m/s^2) - shared between
// updateBall's actual physics and releasePass's distance-assist calc below,
// so the assist's "will this reach them" math always matches how the ball
// really slows down.
const PITCH_FRICTION = 3.2;
// A tap-power pass still arrives with at least this much pace rather than
// dying right at the receiver's feet - see releasePass's distance assist.
// Was 7 - too gentle to really feel like it arrived "with speed", meaning
// the receiver often still had to close the last bit of ground themselves.
const PASS_MIN_ARRIVAL_SPEED = 15;
// Inside this many metres of a touchline/goal line, a pass's usual skill-based
// wobble gets suppressed toward zero - see releasePass's edge assist.
const PASS_EDGE_ASSIST_MARGIN = 4;
// Below this much drag on the Shoot joystick (0..1 of its max throw), a
// release is treated as a plain tap rather than a deliberate aim - see
// bindShootJoystick/onChargeRelease.
const SHOOT_DRAG_THRESHOLD = 0.15;
// Even a bare-minimum-charge shot (SHOT_MIN_SPEED) is faster than a
// fully-charged pass (PASS_MAX_SPEED), so a shot never feels weaker than a
// pass just because it wasn't held as long. Applies equally to both teams -
// releaseShot doesn't distinguish human vs AI.
const SHOT_MIN_SPEED = 24, SHOT_MAX_SPEED = 36;
const GK_SAVE_CHANCE = 0.35;
const GK_SPEED_MULT = 0.55; // goalkeepers move slower than outfield players
const GOAL_DEPTH = 2;       // how far into the net (metres) players/ball can enter, matches the drawn goal frame
const GK_SMOTHER_RADIUS = 2.2;
const GK_SMOTHER_CHANCE = 0.75;
// Its own (shorter) retry timer, separate from TACKLE_RETRY_SEC - a keeper
// closing down a dribbler should get several tries as they close the gap,
// not just one coin-flip attempt before the ball's already crossed the line.
const GK_SMOTHER_RETRY_SEC = 0.3;

// Both sides get a situational edge once play actually reaches a final
// third, same idea as a real match: the attacking side pushes with real
// urgency once they're in the opponent's third (a pace boost), while the
// side defending their OWN third gets a compact, organised-defending edge
// (a tackling boost) - tied to pitch zone rather than possession alone, so
// it applies to everyone in that phase of play, not just the ball carrier.
const FINAL_THIRD_PACE_BOOST = 1.08;
const FINAL_THIRD_TACKLE_BOOST = 1.12;
// A ball carrier's Dribbling (close control) and Strength (holding a
// challenge off) genuinely make them harder to dispossess - previously
// tackle chance only ever looked at the TACKLER's own skill, never who they
// were actually up against. >1 for a strong dribbler/physical carrier
// (divides tackle chance down), <1 for a weak one (tackle chance goes up).
function carrierResistance(carrier) {
  if (!carrier) return 1;
  const dribbling = carrier.dribbling != null ? carrier.dribbling : 1;
  const strength = carrier.strength != null ? carrier.strength : 1;
  return clamp((dribbling + strength) / 2, 0.6, 1.5);
}
function finalThirdMultiplier(team, kind) {
  const thirdX = PITCH_LEN / 3;
  const inAttackThird = team.attackDir === 1 ? G.ball.pos.x > PITCH_LEN - thirdX : G.ball.pos.x < thirdX;
  const inDefendThird = team.attackDir === 1 ? G.ball.pos.x < thirdX : G.ball.pos.x > PITCH_LEN - thirdX;
  if (kind === 'pace' && inAttackThird) return FINAL_THIRD_PACE_BOOST;
  if (kind === 'tackle' && inDefendThird) return FINAL_THIRD_TACKLE_BOOST;
  return 1;
}

// ---------- Momentum/morale ----------
// A short-lived, decaying edge for whoever just scored (and a corresponding
// dip for whoever just conceded) - same idea as a real team riding a "hot"
// few minutes after a goal, or looking rattled right after shipping one.
// Deliberately small and short-lived (see MOMENTUM_DECAY_RATE) next to the
// final-third boost above - this is meant to be a felt nudge, not something
// that snowballs a single goal into a rout on its own.
const MOMENTUM_GOAL_BOOST = 0.4;   // scorer's momentum jumps by this (of a -1..1 range)
const MOMENTUM_CONCEDE_HIT = 0.2;  // conceding side dips by this (smaller - not scored on both fronts at once)
const MOMENTUM_PACE_BOOST_MAX = 0.05;   // +-5% pace at full momentum
const MOMENTUM_TACKLE_BOOST_MAX = 0.08; // +-8% tackle chance at full momentum
// How fast momentum decays back toward 0, scaled against half length the
// same way STAMINA_DRAIN is - a higher number fades the effect out sooner.
// At 6, a goal's swing is mostly gone within a third or so of a half.
const MOMENTUM_DECAY_RATE = 6;
function updateMomentum(dt) {
  if (!G.momentum) return;
  const decay = clamp((dt / G.halfLengthSec) * MOMENTUM_DECAY_RATE, 0, 1);
  G.momentum[0] = lerp(G.momentum[0], 0, decay);
  G.momentum[1] = lerp(G.momentum[1], 0, decay);
}
function momentumMultiplier(team, kind) {
  if (!G.momentum) return 1;
  const idx = G.teams.indexOf(team);
  const m = idx >= 0 ? G.momentum[idx] : 0;
  if (kind === 'pace') return 1 + m * MOMENTUM_PACE_BOOST_MAX;
  if (kind === 'tackle') return 1 + m * MOMENTUM_TACKLE_BOOST_MAX;
  return 1;
}

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
function rotateVec(v, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

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
const RAIN_WOBBLE_BONUS = 0.06; // ~3.5deg of extra pass wobble in the rain for every player, see releasePass

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

// Pushes apart any two players (either team, including goalkeepers) who end
// up closer than PLAYER_MIN_SEP after this frame's movement, so bodies never
// stack on top of each other - each nudged half the overlap so neither side
// "wins" the shove. Run once after every player has moved, not per-player
// mid-loop, so the result doesn't depend on iteration order.
function resolvePlayerCollisions() {
  const all = [];
  for (const team of G.teams) {
    for (const p of team.players) {
      if (!p.sentOff) all.push(p);
    }
  }
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j];
      let dx = b.pos.x - a.pos.x, dy = b.pos.y - a.pos.y;
      let d = Math.hypot(dx, dy);
      if (d >= PLAYER_MIN_SEP) continue;
      if (d < 1e-6) { // exactly stacked - nudge apart on a fixed axis rather than dividing by zero
        dx = 1; dy = 0; d = 1;
      }
      const push = (PLAYER_MIN_SEP - d) / 2;
      const nx = dx / d, ny = dy / d;
      a.pos.x -= nx * push; a.pos.y -= ny * push;
      b.pos.x += nx * push; b.pos.y += ny * push;
      clampToPitch(a.pos);
      clampToPitch(b.pos);
    }
  }
}

// Picks white or near-black text so a team name stays readable when printed
// directly on that team's own (sometimes light, e.g. yellow) shirt colour.
function readableTextColor(hex) {
  const c = hex.replace('#', '');
  const r = parseInt(c.substr(0, 2), 16), g = parseInt(c.substr(2, 2), 16), b = parseInt(c.substr(4, 2), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? '#111111' : '#ffffff';
}

// A longer club name (e.g. "Borussia Mönchengladbach", "Sheffield
// Wednesday") would just get silently ellipsis-cut inside a narrow label
// like the Career dashboard's "Next Fixture" box - this swaps it for a
// short abbreviation instead once it's past a length that box can actually
// fit, e.g. "Manchester United" -> "MU", "West Ham United" -> "WHU". Multi-
// word names use one letter per meaningful word; a single-word name just
// takes its first few letters.
function abbreviateClubName(name) {
  const words = name.split(/\s+/).filter(w => w.length > 0);
  const meaningful = words.filter(w => !['de', 'of', 'the', '&'].includes(w.toLowerCase()));
  const useWords = meaningful.length >= 2 ? meaningful : words;
  if (useWords.length >= 2) return useWords.map(w => w[0]).join('').toUpperCase().slice(0, 4);
  return name.slice(0, 3).toUpperCase();
}
// Only swaps to the short form once the name is long enough that the
// "Next Fixture" box would actually have truncated it - short names
// (Arsenal, Chelsea, ...) still show in full.
function fixtureOpponentLabel(name) {
  return name.length > 14 ? abbreviateClubName(name) : name;
}

// Short code (see LEAGUE_ABBR) with the full name still available as a
// tooltip - used by the team-pick boxes' compact league switcher.
function setLeagueLabel(el, league) {
  if (!el) return;
  el.textContent = LEAGUE_ABBR[league] || league;
  el.title = league;
}

// Fills in a .team-crest element (the in-match scoreboard's crest-home/
// crest-away, and the goal banner's crest) with a club's initials on its
// own shirt colour - no real badge artwork, same idea as the mode-browser's
// club-crest chips elsewhere in the app.
function setTeamCrest(elId, def) {
  const el = document.getElementById(elId);
  if (!el || !def) return;
  el.textContent = def.name.slice(0, 3).toUpperCase();
  el.style.background = def.shirt;
  el.style.color = readableTextColor(def.shirt);
}

// Gives a .team-box panel a look based on the actual club's kit, rather than
// a plain flat colour - a secondary colour (from shorts, or the shirt
// stripe colour where the kit has one) drives both the diagonal .team-box-
// flair sash and the footer accent stripe, and clubs with a real striped
// kit (Newcastle, Southampton, Sheff Utd...) get that reproduced as a
// subtle background pattern (see .team-box-striped). Re-run every time you
// switch club, so the panel's whole style changes with the team, not just
// its base colour.
function styleTeamBox(box, def) {
  if (!box || !def) return;
  const secondary = def.stripe || def.shorts || def.shirt;
  box.style.setProperty('--team-color-2', secondary);
  box.style.setProperty('--team-stripe', def.stripe || secondary);
  box.classList.toggle('team-box-striped', !!def.stripe);
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
// subs visible in one place instead of only flashing on screen once. Each
// entry clears itself off the ticker after EVENT_LOG_LIFESPAN_MS rather than
// only being capped by count - previously an entry could sit on screen for
// the rest of the match if fewer than EVENT_LOG_MAX events followed it,
// which ate up a lot of screen space over a whole match.
const EVENT_LOG_MAX = 5;
const EVENT_LOG_LIFESPAN_MS = 8000;
let eventLogNextId = 1;
function renderEventTicker() {
  const el = document.getElementById('event-ticker');
  if (el) el.innerHTML = G.eventLog.map(e => `<div class="ticker-row">${e.text}</div>`).join('');
}
function logMatchEvent(text) {
  const id = eventLogNextId++;
  G.eventLog.unshift({ text, id });
  if (G.eventLog.length > EVENT_LOG_MAX) G.eventLog.length = EVENT_LOG_MAX;
  renderEventTicker();
  setTimeout(() => {
    G.eventLog = G.eventLog.filter(e => e.id !== id);
    renderEventTicker();
  }, EVENT_LOG_LIFESPAN_MS);
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
const STATE = { MENU: 'MENU', SETUP: 'SETUP', PLAYING: 'PLAYING', PAUSED: 'PAUSED', GOAL: 'GOAL', HALFTIME: 'HALFTIME', FULLTIME: 'FULLTIME', SHOOTOUT: 'SHOOTOUT' };
// ms despite the name. Long enough to comfortably fit the ~6s goal replay
// clip (see REPLAY_WINDOW_MS) plus a couple of seconds of banner hold
// afterward - if this were shorter than the replay, the safety net in
// scoreGoal would cut the replay off before it finished.
const GOAL_CELEBRATION_SEC = 8000;

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
  replayBuffer: [], // rolling REPLAY_WINDOW_MS of recent player/ball positions, for the goal-replay clip - see recordReplayFrame()
  replay: { active: false, frames: null, idx: 0, restoreState: null, everyOther: false, onDone: null }, // see scoreGoal/stepGoalReplay
  lastTs: 0,
  camera: { x: PITCH_LEN / 2, y: PITCH_WID / 2, zoom: CAMERA_ZOOM },
  lastTensionUpdate: 0,
  shotAim: 0, // -1 (left post) .. 1 (right post), steered while charging a penalty/free kick/practice shot
  // The Shoot button's own drag joystick (see bindShootJoystick) - a full
  // 2D direction, world-space (same convention as G.joystick), for aiming
  // an open-play shot exactly where dragged rather than only left/right
  // around a fixed goal-ward line. shootDragMag is how far it's currently
  // pulled from centre, 0..1 - below SHOOT_DRAG_THRESHOLD it's treated as
  // "didn't really aim it", falling back to the existing auto-target/1D
  // dead-ball aim instead.
  shootAimVec: { x: 0, y: 0 },
  shootDragMag: 0,
};

// True whenever the human's current shot is one they can actually steer
// (a placed dead ball), rather than an instinctive open-play strike -
// penalties/free kicks/corners they're taking. Corners were added so a
// human corner-taker can pick a real aim+power delivery into the box
// instead of it just being auto-passed to the nearest teammate like a
// throw-in. forPlayer defaults to G.controlled (every existing call site) -
// the online guest's own guestSteerAim passes G.controlled explicitly too,
// since for the guest that already means "my own player" (see
// interpolateShadowState).
function isAimableShotSituation(forPlayer) {
  const p = forPlayer || G.controlled;
  return !!(G.restart && p === G.restart.taker && (G.restart.kind === 'penalty' || G.restart.kind === 'freekick' || G.restart.kind === 'corner'));
}

// A throw-in isn't shootable (see isAimableShotSituation/restartMustPass),
// but it's still a dead ball worth steering rather than always auto-passing
// to whatever the cone-nearest-teammate logic picks - see releasePass's
// aim handling and THROWIN_AIM_ANGLE.
function isAimableThrowinSituation(forPlayer) {
  const p = forPlayer || G.controlled;
  return !!(G.restart && p === G.restart.taker && G.restart.kind === 'throwin');
}
// How far either side of "straight into the pitch" a throw can be steered -
// at aim=+-1 it's angled sharply forward/back along the touchline while
// still landing in play; a real throw can never go backward OUT of the
// pitch, so this deliberately stops short of a full 90 degrees.
const THROWIN_AIM_ANGLE = Math.PI * 0.42;

// The opponent (team index 1) gets an extra attribute boost on top of their
// real team strength as difficulty rises - your own team (index 0) always
// just plays at its real strength, whichever club you picked.
const DIFFICULTY_OPPONENT_BOOST = { easy: 1.0, medium: 1.08, hard: 1.18, expert: 1.30, legendary: 1.45, champion: 1.55, grandmaster: 1.65, legend: 1.75, mythic: 1.85, invincible: 1.95 };

// Real positions specialise - a striker isn't a good tackler and a
// centre-back isn't a clinical finisher. Applied as a per-attribute
// multiplier on top of the normal team/renown roll (see makeSquadPlayer/
// makeCareerPlayer below), not a separate system - a poor defender can
// still be a poor tackler, a great striker can still be an average
// dribbler, this just biases the AVERAGE toward what's realistic for the
// role instead of every attribute being equally likely for every position.
// Reflexes deliberately isn't biased here - it's rolled the same for
// everyone and only actually matters for the goalkeeper (see gkDiving/
// gkHandling/etc.), so touching it would just quietly shift outfield
// players' computePlayerValue average for no real reason.
const POSITION_ATTR_BIAS = {
  GK: { pace: 0.85, tackling: 0.7, finishing: 0.6, passing: 0.9, dribbling: 0.7, strength: 1.0 },
  DEF: { pace: 0.95, tackling: 1.2, finishing: 0.7, passing: 0.95, dribbling: 0.85, strength: 1.15 },
  MID: { pace: 1.0, tackling: 1.0, finishing: 0.9, passing: 1.15, dribbling: 1.05, strength: 1.0 },
  FWD: { pace: 1.1, tackling: 0.65, finishing: 1.2, passing: 0.9, dribbling: 1.1, strength: 1.0 },
};
// Same pace/tackling/finishing/reflexes blend several older functions use as
// a rough "how good is this player" figure, but with each of the three
// biased terms divided back out by their own POSITION_ATTR_BIAS multiplier
// first (reflexes was never biased, so it passes through as-is). Comparing
// raw attributes straight across DIFFERENT positions (unlike sorting players
// WITHIN one position, which stays valid either way since the same bias
// hits everyone there equally) was systematically under-counting every
// position - a striker's deliberately weak Tackling, a defender's
// deliberately weak Finishing - which was quietly simulating whole squads
// as weaker than they really are. See careerSquadStrength for where this
// actually changes a match outcome, not just a displayed number.
function positionNeutralAvg(cp) {
  const bias = POSITION_ATTR_BIAS[cp.group] || POSITION_ATTR_BIAS.MID;
  return (cp.pace / bias.pace + cp.tackling / bias.tackling + cp.finishing / bias.finishing + cp.reflexes) / 4;
}

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
    // opponent's additionally scaled up by the difficulty boost above -
    // and now biased per-position (see POSITION_ATTR_BIAS) so a striker
    // doesn't roll centre-back-grade tackling by pure chance.
    pace: clamp(rand(0.9, 1.1) * teamFactor * (POSITION_ATTR_BIAS[group] || POSITION_ATTR_BIAS.MID).pace, 0.7, 1.45),
    tackling: clamp(rand(0.85, 1.15) * teamFactor * (POSITION_ATTR_BIAS[group] || POSITION_ATTR_BIAS.MID).tackling, 0.6, 1.5),
    finishing: clamp(rand(0.85, 1.15) * teamFactor * (POSITION_ATTR_BIAS[group] || POSITION_ATTR_BIAS.MID).finishing, 0.6, 1.5),
    reflexes: clamp(rand(0.85, 1.15) * teamFactor, 0.6, 1.5), // only meaningful for the goalkeeper
    // Passing/dribbling/strength - real attributes, not just display stats
    // (see releasePass's wobble and the tackle-chance formulas in
    // aiTackleAttempt/tryHumanTackle/tryRemoteTackle): a low-Passing player's
    // passes stray off target more, and a high-Dribbling/Strength ball
    // carrier is genuinely harder to dispossess.
    passing: clamp(rand(0.85, 1.15) * teamFactor * (POSITION_ATTR_BIAS[group] || POSITION_ATTR_BIAS.MID).passing, 0.6, 1.5),
    dribbling: clamp(rand(0.85, 1.15) * teamFactor * (POSITION_ATTR_BIAS[group] || POSITION_ATTR_BIAS.MID).dribbling, 0.6, 1.5),
    strength: clamp(rand(0.85, 1.15) * teamFactor * (POSITION_ATTR_BIAS[group] || POSITION_ATTR_BIAS.MID).strength, 0.6, 1.5),
    // A real per-player attribute (not the same thing as the in-match
    // `stamina` field below) - a high-Stamina player's fatigue drains
    // slower over the course of a match, see drainStamina(). Deliberately
    // NOT scaled by teamFactor: a big club's star can still be a poor
    // engine-room runner and vice versa, so this is worth scouting for on
    // its own merits rather than just tracking overall quality.
    staminaRating: clamp(rand(0.6, 1.5), 0.6, 1.5),
    cardLevel: 0, // 0 = clean, 1 = yellow, 2 = sent off (red)
    sentOff: false,
    stamina: 1, // 1 = fresh, drains with sprinting/pressing over the match - see drainStamina()
    injured: false, // picked up a knock in a tackle - see maybeInjurePlayer(); lasts the rest of the match
    skinTone: SKIN_TONES[Math.floor(Math.random() * SKIN_TONES.length)],
    hairColor: HAIR_COLORS[Math.floor(Math.random() * HAIR_COLORS.length)],
    goals: 0, // this match only - see scoreGoal(); resets naturally since players are rebuilt each initMatch
    matchTackles: 0, // this match only - see aiTackleAttempt/tryHumanTackle
    realName: null, // only set for the human's own team, and only if that club has squad data - see assignRealNames()
    // Generic placeholder for anyone who doesn't end up with a realName
    // (the opponent side, and any of your own bench slots the squad list
    // ran out of real names for) - assignRealNames overwrites this with the
    // real player's actual known age (see REAL_PLAYER_AGE/resolvePlayerAge)
    // wherever one's on record.
    age: randPlayerAge(18, 35),
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
    if (pool && used[p.group] < pool.length) {
      p.realName = pool[used[p.group]++];
      // Real players get their real known age where one's on record
      // (REAL_PLAYER_AGE) instead of makeSquadPlayer's generic placeholder
      // roll - same lookup Career mode's own squad generation uses.
      p.age = resolvePlayerAge(p.realName, 18, 35);
    }
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
    shirt: useKit.shirt, shorts: useKit.shorts, stripe: useKit.stripe, gkColor,
    pressStyle: def.press || 'mid',
    players, bench, subsRemaining: MAX_SUBS,
  };
  // Both sides now, not just the human's own team - an AI opponent showing
  // as "DEF 3" the whole match (subs screen included) while your own side
  // has real names read as noticeably thinner than it needed to be, and
  // assignRealNames already no-ops harmlessly for any club without real
  // squad data (def.squad).
  assignRealNames(team, def);
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
// A player's real staminaRating attribute (0.6-1.5, see makeSquadPlayer)
// scales how fast their in-match fatigue actually builds - a high-Stamina
// engine-room runner drains at roughly 2/3 the rate of a poor one, so
// signing for fitness genuinely pays off deep into a match, not just on
// paper. Division, not multiplication, so a HIGHER rating means LESS drain.
// Recovery is much slower than drain (roughly a quarter the rate) and only
// kicks in during genuinely light activity (activityMultiplier <= 0.5, the
// same "barely moving" tier drainStamina's callers already pass) - jogging
// gets some fatigue back, sprinting/pressing never does.
const STAMINA_RECOVER_RATE = 0.12;
function drainStamina(p, dt, activityMultiplier) {
  if (p.isGK) return;
  const frac = dt / G.halfLengthSec;
  if (activityMultiplier <= 0.5) {
    const ceiling = p.staminaCeiling != null ? p.staminaCeiling : 1;
    const before = p.stamina;
    p.stamina = clamp(p.stamina + frac * STAMINA_RECOVER_RATE * (p.staminaRating || 1), 0.2, ceiling);
    trackStaminaRecovery(p, p.stamina - before);
    return;
  }
  const staminaMult = 1 / (p.staminaRating || 1);
  p.stamina = clamp(p.stamina - frac * activityMultiplier * STAMINA_DRAIN * staminaMult, 0.2, 1);
}

// Recovering isn't free: every time a player's cumulative in-match recovery
// reaches 30%, their ceiling (the most stamina they can hold from then on)
// permanently drops 5-10% - repeatedly resting and running again wears a
// player down over the match even with breathers, rather than letting them
// yo-yo back to fully fresh indefinitely just by standing still a moment.
const STAMINA_CEILING_CUT_THRESHOLD = 0.3;
function trackStaminaRecovery(p, amount) {
  if (amount <= 0) return;
  p.staminaRecovered = (p.staminaRecovered || 0) + amount;
  if (p.staminaCeiling == null) p.staminaCeiling = 1;
  while (p.staminaRecovered >= STAMINA_CEILING_CUT_THRESHOLD) {
    p.staminaRecovered -= STAMINA_CEILING_CUT_THRESHOLD;
    p.staminaCeiling = clamp(p.staminaCeiling - rand(0.05, 0.1), 0.5, 1);
    p.stamina = Math.min(p.stamina, p.staminaCeiling);
  }
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
// Real footballers routinely play a neighbouring line, not just their one
// listed position (a DEF at wing-back covering MID, a FWD dropping into
// MID, etc.) - GK is the one truly specialist role with no crossover.
// Out-of-position starts are allowed (see startReserveIntoSelectedSlot) at
// a mild attribute penalty (see OUT_OF_POSITION_PENALTY below) rather than
// forbidden outright, and DEF<->FWD isn't in this list - that's too big a
// stretch to allow even at a penalty.
const GROUP_ADJACENT = { GK: [], DEF: ['MID'], MID: ['DEF', 'FWD'], FWD: ['MID'] };
const OUT_OF_POSITION_PENALTY = 0.85;
function canPlayGroup(cp, slotGroup) {
  return cp.group === slotGroup || (GROUP_ADJACENT[cp.group] || []).includes(slotGroup);
}
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

// Same player-card look as the Career squad screens (see formatMatchPlayerRow),
// with a live stamina bar and injury/card badge above each card - not just a
// name in a plain list - so a substitution decision is actually informed by
// who's actually gassed or carrying a knock right now.
// On-pitch side is the same formation-pitch view as the Career squad screen
// (see renderCareerLineupScreen/LINEUP_ROW_TOP/slotPositionAbbr) rather than
// a plain list, with a live stamina bar + injury icon above each marker's
// head instead of the bench cards' fuller status strip (no room for it at
// this size) - reuses the same colour tiers (sub-stamina-high/mid/low).
function renderSubsScreen() {
  const team = G.teams[0];
  document.getElementById('subs-remaining').textContent = `Substitutions remaining: ${team.subsRemaining}`;
  const noSubsLeft = team.subsRemaining <= 0;

  const pitch = document.getElementById('subs-formation-pitch');
  pitch.innerHTML = '';
  team.players.forEach(p => {
    const isSelected = p === pendingSubOut;
    const marker = document.createElement('div');
    marker.className = 'formation-player' + (isSelected ? ' selected' : '');
    marker.style.left = `${p.slot.y * 100}%`;
    marker.style.top = `${LINEUP_ROW_TOP[p.slot.group]}%`;
    marker.title = `${playerLabel(p)} - ${slotPositionName(p.slot)}`;

    const staminaPct = Math.round(clamp(p.stamina != null ? p.stamina : 1, 0, 1) * 100);
    const staminaTier = staminaPct > 60 ? 'high' : staminaPct > 30 ? 'mid' : 'low';
    const status = document.createElement('div');
    status.className = 'formation-player-status';
    status.innerHTML = `
      <div class="formation-player-stamina-bar"><div class="formation-player-stamina-fill sub-stamina-${staminaTier}" style="width:${staminaPct}%"></div></div>
      ${p.injured ? '<span class="formation-player-injury-icon">\u{1FA79}</span>' : ''}
    `;

    const dot = document.createElement('div');
    dot.className = 'formation-player-dot';
    dot.style.setProperty('--kit-color', team.shirt);
    dot.style.setProperty('--kit-text', readableTextColor(team.shirt));
    dot.textContent = slotPositionAbbr(p.slot);

    const nameEl = document.createElement('div');
    nameEl.className = 'formation-player-name';
    nameEl.textContent = playerLabel(p);

    marker.appendChild(status);
    marker.appendChild(dot);
    marker.appendChild(nameEl);
    marker.onclick = () => {
      if (noSubsLeft) return;
      pendingSubOut = isSelected ? null : p; // clicking the already-selected marker deselects, same as the lineup editor
      renderSubsScreen();
    };
    pitch.appendChild(marker);
  });

  const benchEl = document.getElementById('subs-bench');
  benchEl.innerHTML = '';
  const canBringOn = pendingSubOut && team.subsRemaining > 0;
  team.bench.forEach((p, i) => {
    benchEl.appendChild(formatMatchPlayerRow(p, 'Bring On', () => {
      substitutePlayer(team, pendingSubOut, team.bench[i]);
      pendingSubOut = null;
      renderSubsScreen();
    }, { disabled: !canBringOn }));
  });

  document.getElementById('subs-bench-hint').classList.toggle('hidden', !!pendingSubOut || team.subsRemaining <= 0);
}

const SUBS_AUTO_RETURN_SEC = 15;

// Auto-returns you to whichever overlay sent you to the Subs page
// (pause or halftime) if you sit on it too long deciding, rather than
// leaving the match hanging paused indefinitely.
function startSubsAutoTimer(returnTarget) {
  G.subsReturnTarget = returnTarget;
  G.subsRemaining = SUBS_AUTO_RETURN_SEC;
  const secEl = document.getElementById('subs-timer-seconds');
  const fillEl = document.getElementById('subs-timer-fill');
  secEl.textContent = G.subsRemaining;
  fillEl.style.width = '100%';
  if (G.subsTimerInterval) clearInterval(G.subsTimerInterval);
  G.subsTimerInterval = setInterval(() => {
    G.subsRemaining--;
    secEl.textContent = Math.max(G.subsRemaining, 0);
    fillEl.style.width = `${Math.max(G.subsRemaining, 0) / SUBS_AUTO_RETURN_SEC * 100}%`;
    if (G.subsRemaining <= 0) closeSubsScreen(true);
  }, 1000);
}

function stopSubsAutoTimer() {
  if (G.subsTimerInterval) { clearInterval(G.subsTimerInterval); G.subsTimerInterval = null; }
}

// auto=false: the "Back to Pause"/"Back to Half Time" button - just returns,
// match stays exactly as paused as it was. auto=true: the 15s timer ran out
// without you deciding - returns AND (for the pause case) resumes play
// immediately, same as if you'd pressed Resume, rather than leaving the
// match sat paused with nobody looking at it.
function closeSubsScreen(auto) {
  stopSubsAutoTimer();
  const returnTarget = G.subsReturnTarget;
  showScreen('match-screen');
  if (returnTarget === 'halftime') {
    document.getElementById('halftime-overlay').classList.remove('hidden');
    startHalftimeInterval();
  } else {
    document.getElementById('pause-overlay').classList.remove('hidden');
    if (auto) togglePause();
  }
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
  // beginRestart's "face inward" correction is a no-op for a kickoff
  // specifically (the taker is placed exactly ON its own inward-facing
  // reference point, CENTER_POS, so the correction vector is always zero) -
  // that leaves whatever stale facing the taker had from the previous phase
  // of play, which releasePass then uses to pick a pass target. A stale
  // facing pointing toward the touchline could pick a winger standing right
  // on it, sending the kickoff straight out for a throw-in. Face the taker
  // toward their own attacking direction instead, same as a real kickoff.
  kicker.facing = { x: G.teams[kickingIdx].attackDir, y: 0 };
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
  if (G.restart.kind === 'goalkick') {
    // Kicking - a big-legged keeper drives a goal kick further downfield
    // with real pace on it; a weak-legged one barely clears the box.
    releasePass(p, team, clamp(rand(0.55, 0.9) * (0.75 + gkKicking(p) * 0.35), 0.35, 1));
    return;
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

// Every other ALL_CLUBS index in the same league as clubIdx - used to keep
// Season's round-robin and Cup's draw scoped to one sensible division full
// of real rivals, now that Play/Season/Cup pick from every league
// (ALL_CLUBS) instead of just the Premier League (TEAMS).
function sameLeagueClubIdxs(clubIdx) {
  const league = ALL_CLUBS[clubIdx].league;
  return ALL_CLUBS.map((c, i) => i).filter(i => i !== clubIdx && ALL_CLUBS[i].league === league);
}

// Jumps straight to the first club of the next/previous league (in
// CAREER_LEAGUES order) rather than cycling through every club one at a
// time - Play/Season/Cup all pick from all ~116 clubs across 6 leagues now,
// and stepping through every single one just to get from the Premier
// League to Serie A was a lot of taps. The existing team-prev/next arrows
// still cycle club-by-club as before; this is a second, coarser control
// alongside them (see the small league-arrow buttons in each team box).
function jumpToLeagueClub(currentIdx, dir) {
  const curLeague = ALL_CLUBS[currentIdx].league;
  const pos = CAREER_LEAGUES.indexOf(curLeague);
  const nextLeague = CAREER_LEAGUES[(pos + dir + CAREER_LEAGUES.length) % CAREER_LEAGUES.length];
  return ALL_CLUBS.findIndex(c => c.league === nextLeague);
}

// The team prev/next arrows step through clubs WITHIN the current league
// only, wrapping at that league's own start/end rather than drifting into
// the next league - only the dedicated league arrows (jumpToLeagueClub
// above) change league now, so switching league is always a deliberate
// choice, not something that just happens if you cycle teams enough times.
function cycleWithinLeague(currentIdx, dir) {
  const league = ALL_CLUBS[currentIdx].league;
  const clubsInLeague = ALL_CLUBS.map((c, i) => i).filter(i => ALL_CLUBS[i].league === league);
  const pos = clubsInLeague.indexOf(currentIdx);
  return clubsInLeague[(pos + dir + clubsInLeague.length) % clubsInLeague.length];
}

// ---------- Season mode ----------
// A personal campaign against every other team once, with the rest of the
// division racing along beside you too now - every fixture you resolve
// also quick-sims a round of everyone else's games (see advanceLeagueRound,
// shared with Career mode's own tableEstimate), so the League Table tab is
// a real standings table, not just your own record.
let SEASON = null; // { yourIdx, skillKey, halfLenMin, opponentOrder, fixtureIdx, record, results, tableEstimate, view }

function startSeason(yourIdx, halfLenMin, skillKey) {
  const opponentOrder = sameLeagueClubIdxs(yourIdx);
  SEASON = {
    yourIdx, halfLenMin, skillKey, opponentOrder, fixtureIdx: 0,
    record: { played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0 },
    results: [],
    tableEstimate: generateLeagueTableEstimate(yourIdx, ALL_CLUBS[yourIdx].league),
    view: 'fixtures', // 'fixtures' | 'table' - see toggleSeasonView
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
  const oppIdx = SEASON.opponentOrder[SEASON.fixtureIdx];
  SEASON.results.push({ oppIdx, gf, ga });
  advanceLeagueRound(SEASON.tableEstimate, oppIdx, gf, ga);
  SEASON.fixtureIdx++;
}

function toggleSeasonView(view) {
  SEASON.view = view;
  renderSeasonTable();
}

// Sorted full standings including your own row - same points/goal-
// difference tiebreak Career's own table uses.
function seasonStandingsRows() {
  const you = { clubIdx: SEASON.yourIdx, points: SEASON.record.points, gd: SEASON.record.gf - SEASON.record.ga, isYou: true };
  return [you, ...SEASON.tableEstimate].sort((a, b) => b.points - a.points || b.gd - a.gd);
}

function renderSeasonTable() {
  const r = SEASON.record;
  const stat = (label, value) => `<div class="season-stat-chip"><span class="stat-value">${value}</span><span class="stat-label">${label}</span></div>`;
  document.getElementById('season-record').innerHTML = `<div class="season-stat-row">` +
    stat('Played', r.played) + stat('Won', r.won) + stat('Drawn', r.drawn) + stat('Lost', r.lost) +
    stat('Goals', `${r.gf}-${r.ga}`) + stat('Points', r.points) +
    `</div>`;

  document.getElementById('btn-season-view-fixtures').classList.toggle('active', SEASON.view === 'fixtures');
  document.getElementById('btn-season-view-table').classList.toggle('active', SEASON.view === 'table');
  document.getElementById('season-fixtures').classList.toggle('hidden', SEASON.view !== 'fixtures');
  document.getElementById('season-standings').classList.toggle('hidden', SEASON.view !== 'table');

  const rows = SEASON.opponentOrder.map((oppIdx, i) => {
    const oppName = ALL_CLUBS[oppIdx].name;
    if (i < SEASON.results.length) {
      const res = SEASON.results[i];
      const badgeCls = res.gf > res.ga ? 'badge-win' : res.gf === res.ga ? 'badge-draw' : 'badge-loss';
      const letter = res.gf > res.ga ? 'W' : res.gf === res.ga ? 'D' : 'L';
      return `<tr><td>vs ${oppName}</td><td>${res.gf}-${res.ga} <span class="fixture-badge ${badgeCls}">${letter}</span></td></tr>`;
    }
    return `<tr class="fixture-upcoming"><td>vs ${oppName}</td><td>upcoming</td></tr>`;
  });
  document.getElementById('season-fixtures').innerHTML = `<table>${rows.join('')}</table>`;

  // No reliable "Played" column - the other clubs' games are simmed in
  // shuffled pairs each round (see advanceLeagueRound), so how many
  // fixtures any one of them has actually had by now isn't exact - same
  // reason Career's own table (career-table-body) only ever shows
  // Position/Club/Points/GD too.
  const standings = seasonStandingsRows();
  document.getElementById('season-standings').innerHTML = `<table class="season-standings-table">
    <tr><th>#</th><th>Club</th><th>Pts</th><th>GD</th></tr>
    ${standings.map((row, i) => `<tr${row.isYou ? ' class="career-table-you"' : ''}>
      <td>${i + 1}</td><td>${ALL_CLUBS[row.clubIdx].name}</td>
      <td><b>${row.points}</b></td><td>${row.gd >= 0 ? '+' : ''}${row.gd}</td>
    </tr>`).join('')}
  </table>`;

  const seasonDone = SEASON.fixtureIdx >= SEASON.opponentOrder.length;
  document.getElementById('btn-season-next').classList.toggle('hidden', seasonDone);
  document.getElementById('season-awards').classList.toggle('hidden', !seasonDone);
  if (seasonDone) renderSeasonAwards(standings);
}

// A proper end-of-season moment instead of the screen just quietly running
// out of fixtures - your final position, plus league-wide Best Attack/
// Best Defence pulled straight from the same standings the table shows.
function renderSeasonAwards(standings) {
  const yourPosition = standings.findIndex(row => row.isYou) + 1;
  const champion = standings[0];
  // Non-you rows are spread straight from SEASON.tableEstimate (see
  // seasonStandingsRows), so they already carry real gf/ga - only your own
  // row needs it filled in from the record instead.
  const withGoals = standings.map(row => row.isYou ? { ...row, gf: SEASON.record.gf, ga: SEASON.record.ga } : row);
  const bestAttack = [...withGoals].sort((a, b) => b.gf - a.gf)[0];
  const bestDefence = [...withGoals].sort((a, b) => a.ga - b.ga)[0];
  const ord = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
  const row = (label, value) => `<div class="season-award-row"><span>${label}</span><span>${value}</span></div>`;
  document.getElementById('season-awards').innerHTML = `
    <h2 class="season-awards-title">${champion.isYou ? '\u{1F3C6} Champions!' : 'Season Complete'}</h2>
    ${row('League Winner', champion.isYou ? 'You' : ALL_CLUBS[champion.clubIdx].name)}
    ${row('Your Final Position', ord(yourPosition))}
    ${row('Best Attack', `${bestAttack.isYou ? 'You' : ALL_CLUBS[bestAttack.clubIdx].name} (${bestAttack.gf})`)}
    ${row('Best Defence', `${bestDefence.isYou ? 'You' : ALL_CLUBS[bestDefence.clubIdx].name} (${bestDefence.ga} conceded)`)}
  `;
}

// ---------- Cup mode ----------
// Single-elimination knockout: your team plus 4 randomly-drawn opponents
// (sorted weakest-to-strongest, so the Final tends to be the toughest game).
// Every round except the Final is now a two-legged tie (see
// cupRoundIsTwoLegged) decided on aggregate, with extra time/penalties only
// if still level after leg 2 - the Final stays a single match, same as
// before. Both legs are still played as you controlling G.teams[0] against
// the opponent as G.teams[1] (this engine has no path for the human to
// control team 1), so "leg 1 away, leg 2 home" is a labelling/aggregate
// distinction, not a literal side-swap - there's no home advantage modelled
// anywhere else in this game either, so nothing is lost by that.
const CUP_ROUND_NAMES = ['Round of 16', 'Quarter-Final', 'Semi-Final', 'Final'];
let CUP = null; // { yourIdx, halfLenMin, skillKey, opponents:[idx,idx,idx,idx], round, leg, leg1Score, history:[], eliminatedAt, won, trophyShown }

function cupIsFinal() { return CUP.round === CUP_ROUND_NAMES.length - 1; }

function startCup(yourIdx, halfLenMin, skillKey) {
  const pool = sameLeagueClubIdxs(yourIdx);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const opponents = pool.slice(0, CUP_ROUND_NAMES.length).sort((a, b) => (ALL_CLUBS[a].strength || 1) - (ALL_CLUBS[b].strength || 1));
  CUP = { yourIdx, halfLenMin, skillKey, opponents, round: 0, leg: 1, leg1Score: null, history: [], eliminatedAt: null, won: false, trophyShown: false };
  startCupMatch();
}

function startCupMatch() {
  const oppIdx = CUP.opponents[CUP.round];
  if (!cupIsFinal() && CUP.leg === 2) {
    showToast(`Leg 2 - Aggregate ${CUP.leg1Score.ourScore}-${CUP.leg1Score.theirScore}`, '#eab308');
  }
  initMatch(CUP.yourIdx, oppIdx, CUP.halfLenMin, CUP.skillKey);
  showScreen('match-screen');
}

// Whether extra time/penalties should trigger right now - leg 1 of a
// two-legged tie never does (a leg 1 draw is just a draw, nothing's
// decided until leg 2's aggregate), the Final and leg 2 both check whatever
// score actually needs to be level (the single match itself, or the
// aggregate across both legs).
function cupNeedsExtraTime() {
  if (!CUP) return false;
  if (!cupIsFinal() && CUP.leg === 1) return false;
  if (cupIsFinal()) return G.teams[0].score === G.teams[1].score;
  const aggOurs = CUP.leg1Score.ourScore + G.teams[0].score;
  const aggTheirs = CUP.leg1Score.theirScore + G.teams[1].score;
  return aggOurs === aggTheirs;
}

function recordCupResult(shootoutResult) {
  const ourScore = G.teams[0].score, theirScore = G.teams[1].score;
  const oppIdx = CUP.opponents[CUP.round];

  if (!cupIsFinal() && CUP.leg === 1) {
    // Leg 1 - nothing's decided yet, just banked for leg 2's aggregate.
    CUP.leg1Score = { ourScore, theirScore };
    CUP.history.push({ round: CUP.round, oppIdx, leg: 1, ourScore, theirScore, agg: null, pens: null, won: null });
    CUP.leg = 2;
    return;
  }

  let wonMatch, aggText = null;
  if (cupIsFinal()) {
    wonMatch = shootoutResult ? shootoutResult.homePens > shootoutResult.awayPens : ourScore > theirScore;
  } else {
    const aggOurs = CUP.leg1Score.ourScore + ourScore;
    const aggTheirs = CUP.leg1Score.theirScore + theirScore;
    aggText = `${aggOurs}-${aggTheirs}`;
    wonMatch = shootoutResult ? shootoutResult.homePens > shootoutResult.awayPens : aggOurs > aggTheirs;
  }
  CUP.history.push({
    round: CUP.round, oppIdx, leg: cupIsFinal() ? null : 2, ourScore, theirScore, agg: aggText,
    pens: shootoutResult ? { home: shootoutResult.homePens, away: shootoutResult.awayPens } : null,
    won: wonMatch,
  });
  if (wonMatch) {
    if (cupIsFinal()) {
      CUP.won = true;
      const lt = loadLifetime();
      lt.cupsWon++;
      saveLifetime(lt);
    } else {
      CUP.round++;
      CUP.leg = 1;
      CUP.leg1Score = null;
    }
  } else {
    CUP.eliminatedAt = CUP.round;
  }
}

// A confetti-and-fanfare beat right after winning the Final, shown while
// match-screen is still active (dismissed before navigating on to
// cup-progress-screen) - see the cup-trophy-overlay HTML comment for why
// it isn't its own .screen.
function showCupTrophyMoment() {
  document.getElementById('cup-trophy-club').textContent = ALL_CLUBS[CUP.yourIdx].name;
  document.getElementById('cup-trophy-overlay').classList.remove('hidden');
  confettiBurst(ALL_CLUBS[CUP.yourIdx].shirt, 18);
  SFX.goal();
}

function renderCupProgress() {
  const statusEl = document.getElementById('cup-status');
  if (CUP.won) {
    statusEl.innerHTML = '<div class="season-stat-row"><div class="season-stat-chip"><span class="stat-value">&#127942;</span><span class="stat-label">Champions</span></div></div>';
  } else if (CUP.eliminatedAt != null) {
    statusEl.innerHTML = `<div class="season-stat-row"><div class="season-stat-chip"><span class="stat-value">Out</span><span class="stat-label">${CUP_ROUND_NAMES[CUP.eliminatedAt]}</span></div></div>`;
  } else {
    const legLabel = cupIsFinal() ? '' : ` — Leg ${CUP.leg}${CUP.leg === 2 ? ` (Agg ${CUP.leg1Score.ourScore}-${CUP.leg1Score.theirScore})` : ''}`;
    statusEl.innerHTML = `<div class="season-stat-row"><div class="season-stat-chip"><span class="stat-value">${CUP_ROUND_NAMES[CUP.round]}</span><span class="stat-label">vs ${ALL_CLUBS[CUP.opponents[CUP.round]].name}${legLabel}</span></div></div>`;
  }
  const rows = CUP.history.map(h => {
    const oppName = ALL_CLUBS[h.oppIdx].name;
    const roundLabel = CUP_ROUND_NAMES[h.round] + (h.leg ? ` (Leg ${h.leg})` : '');
    if (h.won == null) {
      // Leg 1 of a still-in-progress two-legged tie - no result badge yet.
      return `<tr><td>${roundLabel}</td><td>vs ${oppName}</td><td>${h.ourScore}-${h.theirScore}</td></tr>`;
    }
    const badgeCls = h.won ? 'badge-win' : 'badge-loss';
    const letter = h.won ? 'W' : 'L';
    const scoreText = h.pens
      ? `${h.agg || `${h.ourScore}-${h.theirScore}`} (pens ${h.pens.home}-${h.pens.away})`
      : (h.agg ? `${h.agg} agg` : `${h.ourScore}-${h.theirScore}`);
    return `<tr><td>${roundLabel}</td><td>vs ${oppName}</td><td>${scoreText} <span class="fixture-badge ${badgeCls}">${letter}</span></td></tr>`;
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
// entries are literally the same objects Play/Season/Cup read), so
// mutating it directly would leak one save's 20-season history into every
// other save AND into non-Career modes. CAREER.worldState[clubIdx] holds
// only the clubs actually touched so far; everything else falls back to the
// original ALL_CLUBS[i] data untouched.
// CAREER may be null here (advanceLeagueRound is now shared with Season
// mode too, which has no career world-state at all) - falls back straight
// to the base ALL_CLUBS data in that case, same as any club career hasn't
// touched yet.
function effectiveClub(clubIdx) {
  const base = ALL_CLUBS[clubIdx];
  const w = CAREER && CAREER.worldState && CAREER.worldState[clubIdx];
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

// The rest of the footballing world actually trades with itself too, not
// just quietly refreshing one name at a time (see evolveWorldClub above,
// which still runs alongside this for every club every season) - each
// season a handful of real transfers happen between two OTHER clubs (never
// involving you or your own squad - that's the human transfer market
// instead, see signPlayer), always flowing from a weaker/equal club to a
// stronger-or-same one, same "talent drifts upward" pattern as
// careerReputation/BUY_REPUTATION_GAP enforces for your own signings. A
// moved player keeps their rolled attributes if they'd already been viewed
// (w.generated) - only their club/name-list membership changes.
const WORLD_TRANSFERS_PER_SEASON = [15, 30];
function simulateWorldTransfers() {
  const groups = ['GK', 'DEF', 'MID', 'FWD'];
  const moves = Math.floor(rand(WORLD_TRANSFERS_PER_SEASON[0], WORLD_TRANSFERS_PER_SEASON[1]));
  for (let m = 0; m < moves; m++) {
    const sellerIdx = Math.floor(Math.random() * ALL_CLUBS.length);
    if (sellerIdx === CAREER.clubIdx) continue;
    const sellerStrength = effectiveClub(sellerIdx).strength || 1;
    const buyerCandidates = ALL_CLUBS
      .map((c, i) => i)
      .filter(i => i !== sellerIdx && i !== CAREER.clubIdx && (effectiveClub(i).strength || 1) >= sellerStrength - 0.05);
    if (!buyerCandidates.length) continue;
    const buyerIdx = buyerCandidates[Math.floor(Math.random() * buyerCandidates.length)];
    const group = groups[Math.floor(Math.random() * groups.length)];
    const sw = ensureWorldState(sellerIdx);
    const list = sw.squad[group];
    if (!list.length) continue;
    const i = Math.floor(Math.random() * list.length);
    const [name] = list.splice(i, 1);
    const movedAttrs = sw.generated[name];
    delete sw.generated[name];
    const bw = ensureWorldState(buyerIdx);
    bw.squad[group].push(name);
    if (movedAttrs) bw.generated[name] = movedAttrs; // keep their rolled attributes, just re-homed
    // Seller brings in a fresh young replacement, same idea as when the
    // human buys someone away in signPlayer.
    const prospect = generateRegenName();
    list.push(prospect);
    sw.youngNames = sw.youngNames || [];
    sw.youngNames.push(prospect);
  }
}

// Rescales every club's real TEAMS[i].strength onto a wide £50m-£300m
// starting-budget range (computed off whatever the actual weakest/strongest
// club in TEAMS currently is, rather than hardcoded numbers, so this keeps
// working if TEAMS' strengths are ever retuned) - a real Man City vs Burnley
// gap instead of the much flatter spread a simple linear formula gave before.
// Floor kept at £50m rather than lower so even the weakest club can actually
// afford to sign someone.
// A real Premier League club's kitty dwarfs a Championship one's even when
// both are mid-table in their own division - applied on top of the
// within-league relative shape below, not instead of it.
const LEAGUE_BUDGET_MULT = {
  'Premier League': 1.6, 'La Liga': 1.15, 'Bundesliga': 1.1, 'Serie A': 1.05, 'Ligue 1': 1.0,
  'EFL Championship': 0.35,
};
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
  return Math.round((50 + t * 250) * (LEAGUE_BUDGET_MULT[def.league] || 1));
}

// Driven off computePlayerRatings' Overall (1-99, position-aware) rather
// than a raw 4-attribute average. It used to be (pace+tackling+finishing+
// reflexes)/4 directly, but once POSITION_ATTR_BIAS started deliberately
// suppressing attributes that don't belong to a position (a striker's
// Tackling, a defender's Finishing, ...), that same raw average started
// dragging genuinely elite players' VALUE down too - a world-class striker
// with great pace/finishing but intentionally poor Tackling was pricing as
// cheap, which is the "some players are much cheaper than they should be"
// bug. Overall already blends the RIGHT stats for whatever position a
// player actually plays (six-stat outfield blend, or the five GK stats for
// a keeper - see computePlayerRatings), so it doesn't have this problem.
// A cubed curve on Overall/99, not a flat +£40m floor on top of a linear
// scale - real transfer fees aren't linear in ability, the very best command
// a huge premium while an average pro is worth a fraction of that, and a
// fringe/bench-tier player is worth next to nothing. A 4th-power curve (an
// earlier version) was too aggressive: nearly every regular starter got
// pushed toward the top - wildly overpriced stars (£200m+) and everyday
// squad players compressed down near-worthless. This spreads it into a more
// believable range: ~£3-8m for a fringe player, ~£25-40m for a solid
// regular, ~£90-120m only for a genuinely maxed-out player, nothing above
// £200m regardless.
function computePlayerValue(cp) {
  const overall = computePlayerRatings(cp).overall;
  const ageFactor = cp.age < 21 ? 0.8 : cp.age <= 29 ? 1.2 : cp.age <= 33 ? 0.9 : 0.5;
  return clamp(Math.round(Math.pow(overall / 99, 3) * 85 * ageFactor), 2, 200);
}

// Converts the game's internal 0.6-1.5 attribute scale to a FIFA/FC-style
// 1-99 rating. A single power-curve doesn't track how real card ratings
// actually feel (a typical pro isn't halfway between 1 and 99), so this is a
// piecewise-linear ramp through hand-picked anchor points instead - a weak
// fringe player lands in the 40s, a solid regular around 70, and a real
// star (avg ~1.35-1.4, matching what RENOWN_OVERRIDE and a top club's best
// XI slot actually combine to roll - see renownFactor) lands high-80s to
// low-90s, exactly the band asked for. Only 1.5 (the hard ceiling, now
// essentially unreachable without an unlucky/lucky attribute roll on top
// of an already-elite renown+team combo) reaches the high 90s.
const OVERALL_RATING_ANCHORS = [[0.6, 40], [0.85, 58], [1.0, 70], [1.15, 80], [1.3, 87], [1.4, 91], [1.5, 96]];
function attrToRating(avg) {
  const pts = OVERALL_RATING_ANCHORS;
  if (avg <= pts[0][0]) return pts[0][1];
  if (avg >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    if (avg >= x0 && avg <= x1) return Math.round(lerp(y0, y1, (avg - x0) / (x1 - x0)));
  }
  return pts[pts.length - 1][1];
}
// A tiny deterministic pseudo-random offset, seeded off the player's own id
// (stable across renders - the same player always shows the same sub-stats,
// rather than them flickering to new numbers every time the card redraws).
function seededJitter(seed, spread) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return (x - Math.floor(x) - 0.5) * 2 * spread;
}
// Raw-scale (same 0.6-1.5 range as pace/tackling/etc, no attrToRating/jitter)
// goalkeeper blends - the SAME formulas computePlayerRatings below turns
// into the Diving/Handling/Kicking/Positioning display stats, but usable
// directly in match sim code (see checkGoalkeeperSmother/resolveGoalAttempt/
// handleRestartTaker/goalkeeperTarget) the same way gk.reflexes already was.
// One shared definition so what's shown on the card and what actually
// happens on the pitch can never drift apart.
function gkDiving(gk) { return gk.reflexes * 0.65 + gk.pace * 0.35; }
function gkHandling(gk) { return gk.reflexes * 0.6 + gk.strength * 0.4; }
function gkKicking(gk) { return (gk.passing != null ? gk.passing : gk.finishing) * 0.6 + gk.strength * 0.4; }
function gkPositioning(gk) { return gk.tackling * 0.5 + gk.reflexes * 0.5; }

// The six FIFA/FC-style sub-ratings plus an Overall - blended from the
// game's real attributes (each of these actually drives gameplay, see
// releasePass's wobble and the tackle-chance formulas), not invented purely
// for display. Passing/Dribbling/Strength lean on a blend of the closest
// real attributes since there's no single 1:1 source stat for them.
// Goalkeepers get their own FC-style set instead (Diving/Handling/Kicking/
// Reflexes/Positioning) - the outfield six don't mean anything for a GK
// (nobody's scouting a keeper's Dribbling), and every one of these five
// actually drives something distinct on the pitch too (see the gk* helpers
// above and where they're used in the match sim), not just shown for show.
function computePlayerRatings(cp) {
  // cp.id is a persistent career player's stable identity - a live MATCH
  // player object (see makeSquadPlayer) doesn't have one, only .idx, but
  // still has every attribute this needs, so it works fine here too (e.g.
  // the Subs screen reusing this same rating/card display - see
  // formatMatchPlayerRow) as long as the seed falls back sensibly instead
  // of multiplying against undefined and turning every rating into NaN.
  const seed = cp.id != null ? cp.id : cp.idx || 0;
  const clamp99 = v => clamp(Math.round(v), 1, 99);
  // Stamina is shown alongside the core stats either way (it's a real,
  // scouting-relevant attribute - see drainStamina) but deliberately left
  // out of Overall, which stays anchored to footballing ability.
  const stamina = clamp99(attrToRating(cp.staminaRating != null ? cp.staminaRating : 1) + seededJitter(seed * 8.5, 3));

  if (cp.group === 'GK') {
    const reflexes = attrToRating(cp.reflexes) + seededJitter(seed * 1.1, 2);
    const diving = attrToRating(gkDiving(cp)) + seededJitter(seed * 2.3, 2);
    const handling = attrToRating(gkHandling(cp)) + seededJitter(seed * 3.7, 2);
    const kicking = attrToRating(gkKicking(cp)) + seededJitter(seed * 4.9, 3);
    const positioning = attrToRating(gkPositioning(cp)) + seededJitter(seed * 6.1, 3);
    const overall = clamp99((diving + handling + kicking + reflexes + positioning) / 5);
    return { overall, isGK: true, diving: clamp99(diving), handling: clamp99(handling), kicking: clamp99(kicking), reflexes: clamp99(reflexes), positioning: clamp99(positioning), stamina };
  }

  const speed = attrToRating(cp.pace) + seededJitter(seed * 1.1, 2);
  const shooting = attrToRating(cp.finishing) + seededJitter(seed * 2.3, 2);
  const tackling = attrToRating(cp.tackling) + seededJitter(seed * 3.7, 2);
  const passing = attrToRating(cp.passing != null ? cp.passing : (cp.finishing + cp.tackling) / 2) + seededJitter(seed * 4.9, 3);
  const dribbling = attrToRating(cp.dribbling != null ? cp.dribbling : (cp.pace + cp.finishing) / 2) + seededJitter(seed * 6.1, 3);
  const strength = attrToRating(cp.strength != null ? cp.strength : (cp.tackling + cp.reflexes) / 2) + seededJitter(seed * 7.3, 3);
  const overall = clamp99((speed + shooting + passing + dribbling + tackling + strength) / 6);
  return { overall, isGK: false, speed: clamp99(speed), shooting: clamp99(shooting), passing: clamp99(passing), dribbling: clamp99(dribbling), tackling: clamp99(tackling), strength: clamp99(strength), stamina };
}

// A season's wages as a fraction of transfer value - real wage-to-value
// ratios sit roughly in this range (a club typically pays a meaningful slice
// of a player's market value in salary every year they're under contract).
// Older players skew a bit higher (paid more for experience relative to
// resale value); young prospects skew lower (paid for potential, not yet
// proven enough to command a big wage).
const WAGE_RATE = 0.12;
function computePlayerWage(cp) {
  const ageMult = cp.age >= 30 ? 1.15 : cp.age < 23 ? 0.75 : 1;
  return Math.max(0.2, Math.round(cp.value * WAGE_RATE * ageMult * 10) / 10);
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
    // RENOWN_OVERRIDE only affects freshly-generated players - anyone already
    // rolled before a name was added to it (or before the override existed
    // at all) is stuck with whatever weak attributes their old mid-pack
    // renown produced. Bump each attribute up to a floor roughly matching
    // what a max-renown roll would produce at its low end, rather than a
    // full reroll - fixes the "plays badly" complaint while still leaving
    // some individuality above that floor.
    if (RENOWN_OVERRIDE[cp.name] != null) {
      const floor = 1.15;
      ['pace', 'tackling', 'finishing', 'reflexes'].forEach(attr => {
        if (cp[attr] < floor) cp[attr] = clamp(floor + rand(0, 0.15), floor, 1.5);
      });
    }
    // Passing/dribbling/strength didn't exist before - backfill an older
    // save's players with values in line with their existing overall
    // quality (plus a little individual spread) rather than a flat default,
    // so someone who was already a good player doesn't suddenly show up
    // with a below-average Passing rating out of nowhere.
    if (cp.passing == null || cp.dribbling == null || cp.strength == null) {
      const base = (cp.pace + cp.tackling + cp.finishing + cp.reflexes) / 4;
      if (cp.passing == null) cp.passing = clamp(base + rand(-0.1, 0.1), 0.6, 1.5);
      if (cp.dribbling == null) cp.dribbling = clamp(base + rand(-0.1, 0.1), 0.6, 1.5);
      if (cp.strength == null) cp.strength = clamp(base + rand(-0.1, 0.1), 0.6, 1.5);
    }
    // Stamina is deliberately NOT derived from overall quality (see the
    // makeCareerPlayer comment - it's an independent trait), so an older
    // save without it gets a fresh independent roll rather than a
    // quality-linked backfill.
    if (cp.staminaRating == null) cp.staminaRating = clamp(rand(0.6, 1.5), 0.6, 1.5);
    cp.value = computePlayerValue(cp); // always refreshed, not just on an age correction - see comment above
    cp.wage = computePlayerWage(cp);
    if (cp.contractYears == null) cp.contractYears = Math.floor(rand(cp.age < 24 ? 3 : 1, cp.age < 24 ? 6 : 4)); // self-heal an older save from before contracts existed
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
  'Kepa Arrizabalaga': 31, 'Tommy Setford': 20, 'Jurriën Timber': 25, 'Ben White': 28, 'Riccardo Calafiori': 24, 'Myles Lewis-Skelly': 19, 'Cristhian Mosquera': 22, 'Piero Hincapié': 24, 'Martín Zubimendi': 27, 'Mikel Merino': 30, 'Fabio Vieira': 26, 'Ethan Nwaneri': 19, 'Gabriel Jesus': 29, 'Reiss Nelson': 26,
  // Aston Villa
  'Emiliano Martínez': 33, 'Ezri Konsa': 28, 'John McGinn': 30, 'Ollie Watkins': 29,
  'Robin Olsen': 36, 'Marco Bizot': 35, 'Pau Torres': 29, 'Lucas Digne': 33, 'Matty Cash': 29, 'Tyrone Mings': 33, 'Ian Maatsen': 24, 'Victor Lindelöf': 32, 'Kosta Nedeljković': 20, 'Youri Tielemans': 29, 'Boubacar Kamara': 26, 'Amadou Onana': 24, 'Morgan Rogers': 24, 'Ross Barkley': 32, 'Donyell Malen': 27, 'Leon Bailey': 29, 'Emiliano Buendía': 29, 'Evann Guessand': 25, 'Kaine Kesler-Hayden': 23,
  // Bournemouth
  'Illia Zabarnyi': 23, 'Antoine Semenyo': 25, 'Evanilson': 26,
  'Norberto Neto': 37, 'Mark Travers': 27, 'Will Dennis': 26, 'Marcos Senesi': 29, 'Adam Smith': 35, 'Bafodé Diakité': 25, 'Julián Araujo': 24, 'Álex Jiménez': 21, 'Ryan Fredericks': 33, 'James Hill': 24, 'Ryan Christie': 31, 'Alex Scott': 22, 'Tyler Adams': 27, 'David Brooks': 28, 'Ben Pearson': 31, 'Philip Billing': 30, 'Dango Ouattara': 24, 'Enes Ünal': 29, 'Justin Kluivert': 27, 'Eli Junior Kroupi': 20,
  // Brentford
  'Mark Flekken': 32, 'Nathan Collins': 24, 'Kevin Schade': 23, 'Yoane Wissa': 28,
  'Thomas Strakosha': 31, 'Hákon Rafn Valdimarsson': 24, 'Ethan Pinnock': 33, 'Rico Henry': 29, 'Sepp van den Berg': 24, 'Aaron Hickey': 24, 'Kristoffer Ajer': 28, 'Ben Mee': 36, 'Michael Kayode': 22, 'Christian Nørgaard': 32, 'Mathias Jensen': 30, 'Vitaly Janelt': 28, 'Mikkel Damsgaard': 26, 'Yehor Yarmoliuk': 22, 'Igor Thiago': 25, 'Fábio Carvalho': 23, 'Keane Lewis-Potter': 25, 'Gustavo Nunes': 20,
  // Brighton
  'Bart Verbruggen': 23, 'Lewis Dunk': 34, 'Kaoru Mitoma': 28, 'Danny Welbeck': 35,
  'Jason Steele': 35, 'Jan Paul van Hecke': 26, 'Pervis Estupiñán': 28, 'Tariq Lamptey': 25, 'Adam Webster': 31, 'Igor Julio': 28, 'Diego Coppola': 22, 'Ferdi Kadıoğlu': 26, 'Carlos Baleba': 22, 'James Milner': 40, 'Jack Hinshelwood': 21, "Matt O'Riley": 25, 'Georginio Rutter': 24, 'Yasin Ayari': 22, 'Yankuba Minteh': 22, 'Simon Adingra': 24, 'Evan Ferguson': 21, 'Stefanos Tzimas': 20,
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
  'Michele Di Gregorio': 29, 'Mattia Perin': 33, 'Carlo Pinsoglio': 36, 'Gleison Bremer': 29, 'Federico Gatti': 28,
  'Pierre Kalulu': 26, 'Andrea Cambiaso': 26, 'Juan Cabal': 25, 'Lloyd Kelly': 27, 'Khéphren Thuram': 25,
  'Teun Koopmeiners': 28, 'Weston McKennie': 27, 'Fabio Miretti': 23, 'Kenan Yıldız': 21, 'Francisco Conceição': 23, 'Randal Kolo Muani': 27,
  // Inter Milan
  'Yann Sommer': 36, 'Alessandro Bastoni': 26, 'Nicolò Barella': 28, 'Lautaro Martínez': 27, 'Marcus Thuram': 27,
  // AC Milan
  'Mike Maignan': 30, 'Theo Hernández': 27, 'Rafael Leão': 26,
  // Napoli
  'Alex Meret': 28, 'Giovanni Di Lorenzo': 32, 'Romelu Lukaku': 32, 'Scott McTominay': 29,
  'Billy Gilmour': 25, 'Alessandro Buongiorno': 27, 'Noa Lang': 27, 'Mathías Olivera': 28, 'David Neres': 29,
  'Frank Anguissa': 30, 'Stanislav Lobotka': 31, 'Amir Rrahmani': 32, 'Leonardo Spinazzola': 33, 'Matteo Politano': 33,
  // AS Roma
  'Mile Svilar': 26, 'Pierluigi Gollini': 31, 'Gianluca Mancini': 30, 'Evan Ndicka': 26, 'Mario Hermoso': 31, 'Wesley': 22,
  'Devyne Rensch': 23, 'Bryan Cristante': 31, 'Manu Koné': 25, 'Lorenzo Pellegrini': 30, 'Niccolò Pisilli': 21,
  'Paulo Dybala': 32, 'Matías Soulé': 23, 'Tommaso Baldanzi': 23, 'Zeki Çelik': 29,
  // --- EFL Championship ---
  // Leicester City
  'Danny Ward': 32, 'Wout Faes': 27, 'Jannik Vestergaard': 33, 'Ricardo Pereira': 32, 'James Justin': 27,
  'Victor Kristiansen': 23, 'Wilfred Ndidi': 29, 'Oliver Skipp': 25, 'Patson Daka': 27, 'Stephy Mavididi': 27, 'Abdul Fatawu': 21,
  'Jakub Stolarczyk': 25, 'Caleb Okoli': 25, 'Ben Nelson': 22, 'Hamza Choudhury': 28, 'Daniel Iversen': 29, 'Bilal El Khannouss': 22, 'Tawanda Chirewa': 23, 'Jordan Ayew': 34,
  // Southampton
  'Alex McCarthy': 36, 'Jan Bednarek': 30, 'Jack Stephens': 31, 'Adam Armstrong': 29, 'Ryan Fraser': 32, 'Flynn Downes': 26,
  'Ryan Manning': 30, 'Yukinari Sugawara': 26, 'Taylor Harwood-Bellis': 24, 'Cameron Archer': 24, 'Joe Lumley': 31, 'Callum Slattery': 27, 'Will Smallbone': 26, 'Harry Lewis': 28, 'Kamaldeen Sulemana': 23, 'Tyler Dibling': 20, 'Shea Charles': 22, 'Callum Chambers': 30,
  // Ipswich Town
  'Vaclav Hladky': 33, 'Sam Morsy': 34, 'Omari Hutchinson': 22, 'Leif Davis': 26, 'Kalvin Phillips': 30,
  'Christian Walton': 30, "Dara O'Shea": 27, 'Ben Johnson': 26, 'Harry Clarke': 25, 'Jack Taylor': 28, 'George Hirst': 27, 'Cameron Burgess': 30, 'George Edmundson': 28, 'Nathan Broadhead': 28, 'Cieran Slicker': 23, 'Corrie Ndaba': 26, 'Jens Cajuste': 28, 'Massimo Luongo': 33,
  // West Bromwich Albion
  'Alex Palmer': 29, 'Semi Ajayi': 32, 'Kyle Bartley': 34, 'John Swift': 30, 'Josh Maja': 27, 'Jed Wallace': 32,
  'Conor Townsend': 33, 'Jayson Molumby': 27, 'Alex Mowatt': 31, 'Mikey Johnston': 27, 'Josh Griffiths': 24, 'Cedric Kipre': 29, 'Tom Fellows': 23, 'Zac Ashworth': 23, 'Wes Foderingham': 35, 'Erik Pieters': 38, 'Torbjørn Heggem': 27, 'Daryl Dike': 27, 'Grady Diangana': 28, 'Devante Cole': 32,
  // Norwich City
  'Angus Gunn': 30, 'Grant Hanley': 34, 'Shane Duffy': 34, 'Borja Sainz': 25, 'Adam Idah': 25, 'Marcelino Núñez': 26,
  'Ben Chrisene': 22, 'Kenny McLean': 34, 'Kellen Fisher': 22, 'George Long': 32, 'Callum Doyle': 22, 'Archie Mair': 25, 'Bali Mumba': 24, 'Dimitris Giannoulis': 28, 'Gabriel Sara': 27, 'Christian Fassnacht': 31, 'Josh Sargent': 26, 'Jonathan Rowe': 22,
  // Middlesbrough
  'Dael Fry': 28, 'Emmanuel Latte Lath': 26, 'Hayden Hackney': 24,
  'Seny Dieng': 31, 'Sol Brynn': 25, 'Neto Borges': 29, 'Alex Bangura': 27, 'Aidan Morris': 24, 'Matt Clarke': 29, 'Sam Greenwood': 24, 'Finn Azaz': 25, 'Delano Burgzorg': 27, 'Tom Glover': 26, 'Rav van den Berg': 22, 'Anfernee Dijksteel': 29, 'Jonny Howson': 38, 'Dan Barlaser': 28, 'Ben Doak': 20,
  // Sheffield Wednesday
  'Barry Bannan': 36, 'James Beadle': 21, 'Michael Smith': 34, 'Josh Windass': 32,
  "Di'Shon Bernard": 25, 'Max Lowe': 29, 'Yan Valery': 27, 'Liam Palmer': 34, 'Charlie McNeill': 22, 'Pierce Charles': 21, 'Bailey Cadamarteri': 21, 'Chey Dunkley': 32, 'Jack Hunt': 35, 'Bambo Diaby': 27, 'Yosuke Ideguchi': 30, 'Djeidi Gassama': 22, 'Anthony Musaba': 25,
  // Watford
  'Jonathan Bond': 34, 'Daniel Bachmann': 31, 'Ken Sema': 32, 'Giorgi Chakvetadze': 25, 'Vakoun Bayo': 29,
  'Mattie Pollock': 24, 'Edo Kayembe': 28, 'Rocco Vata': 21, 'Antonio Tikvić': 22, 'Yaser Asprilla': 23, 'Tom Dele-Bashiru': 26, 'Rhys Healey': 30, 'Mileta Rajović': 27, 'Matheus Martins': 23, 'Wesley Hoedt': 32, 'Jamal Lewis': 28, 'Francisco Sierralta': 29, 'Ryan Porteous': 26,
  // Sheffield United
  'Anel Ahmedhodžić': 26, 'Gustavo Hamer': 28, 'Kieffer Moore': 33, 'Rhian Brewster': 26,
  'Michael Cooper': 26, 'Adam Davies': 34, 'Rhys Norrington-Davies': 27, 'Femi Seriki': 24, 'Sydie Peck': 21, 'Louie Marsh': 22, 'Jack Robinson': 32, 'Andre Brooks': 22, 'Ben Brereton Díaz': 27, 'Chris Basham': 37, 'Jayden Bogle': 26, 'Vinícius Souza': 26, 'Tom Davies': 28,
  // Coventry City
  'Ben Sheaf': 27, 'Ellis Simms': 24, 'Haji Wright': 27, 'Jake Bidwell': 33,
  'Oliver Dovin': 24, 'Ben Wilson': 34, 'Bobby Thomas': 25, 'Joel Latibeaudiere': 26, 'Josh Eccles': 26, 'Jack Rudoni': 25, 'Tatsuhiro Sakamoto': 29, 'Jojo Wollacott': 31, 'Brooke Norton-Cuffy': 23, 'Josh Wilson-Esbrand': 23, 'Luis Binks': 23, 'Norman Bassette': 20, 'Jayden Wareham': 23,
  // Bristol City
  'Zak Vyner': 28, 'Nahki Wells': 35, 'Ross Stewart': 29, 'Tommy Conway': 23,
  'Rob Atkinson': 28, 'Cam Pring': 28, 'George Tanner': 26, 'Jason Knight': 25, 'Yu Hirakawa': 25, 'Anis Mehmeti': 25, 'Radek Vitek': 22, 'Ross McCrorie': 28, "Max O'Leary": 28, 'Kal Naismith': 33, 'Sinclair Armstrong': 22, 'Harry Cornick': 29, 'Ross McCormack': 39, 'Stefan Marinović': 34,
  // Preston North End
  'Freddie Woodman': 29, 'Emil Riis': 27, 'Will Keane': 33, 'Robbie Brady': 34,
  'Liam Lindsay': 30, 'Andrew Hughes': 34, 'Ali McCann': 26, 'Milutin Osmajić': 27, 'Ben Whiteman': 30, 'Liam Millar': 26, 'Ryan Ledson': 28, 'Duane Holmes': 32, 'Josh Onomah': 29, 'Jack Whatmough': 29, 'Mads Frøkjær': 27,
  // Swansea City
  'Ben Cabango': 26, 'Josh Key': 22, 'Liam Cullen': 24,
  'Lawrence Vigouroux': 32, 'Josh Tymon': 27, 'Goncalo Franco': 25, 'Ben Lloyd': 21, 'Ronald': 25, 'Zan Vipotnik': 24, 'Harry Darling': 27, 'Nathan Wood': 24, 'Nathan Young-Coombes': 23, 'Jamie Paterson': 34, 'Josh Ginnelly': 28, 'Ollie Cooper': 25, 'Matty Sorinola': 24,
  // Hull City
  'Jacob Greaves': 24, 'Ozan Tufan': 31,
  'Charlie Hughes': 22, 'Ryan Giles': 26, 'Regan Slater': 26, 'Cody Drameh': 24, 'Ryan Allsop': 34, 'Alfie Jones': 28, 'Jaden Philogene': 24, 'Ryan Longman': 25, 'Abu Kamara': 23, 'Reece Burke': 29, 'Joe Gelhardt': 24, 'Liam Delap': 23, 'Muskwe Karim': 27, 'Ivor Pandur': 24,
  // Millwall
  'George Saville': 32, 'Zian Flemming': 27, 'Duncan Watmore': 31,
  'Lukas Jensen': 27, 'Ryan Leonard': 34, 'Casper De Norre': 29, 'Josh Coburn': 23, 'Japhet Tanganga': 27, 'Jamie Shackleton': 26, 'Billy Mitchell': 25, 'Aidomo Emakhu': 22, 'Liam Roberts': 31, 'Kevin Nisbet': 29, 'Wes Harding': 29,
  // Blackburn Rovers
  'Sondre Tronstad': 30, 'Todd Cantwell': 27, 'Andreas Weimann': 34, 'Sammie Szmodics': 30,
  'Aynsley Pears': 28, 'Yuki Ohashi': 30, 'Dominic Hyam': 30, 'Callum Brittain': 28, 'Joe Rankin-Costello': 27, 'Ryan Hedges': 30, 'Arnor Sigurdsson': 29, 'Tom Trybull': 33,
  // Stoke City
  'Viktor Johansson': 26, 'Ben Wilmot': 25, 'Lewis Baker': 30,
  'Junior Tchamadeu': 22, 'Eric Bocat': 27, 'Bae Jun-ho': 22, 'Million Manhoef': 24, 'Andrew Moran': 22, 'Tom Cannon': 23, 'Jack Bonham': 32, 'Nathan Lowe': 20, 'Michael Rose': 30, 'Enda Stevens': 36, 'Connor Taylor': 24, 'Wouter Burger': 26, 'Ryan Mmaee': 28,
  // Portsmouth
  'Colby Bishop': 28, 'Marlon Pack': 34,
  'Connor Ogilvie': 30, 'Zak Swanson': 25, 'Regan Poole': 28, 'Conor Shaughnessy': 30, 'Terry Devlin': 22, 'Josh Murphy': 31, 'Alfie Devine': 22, 'Callum Lang': 27, 'Jay Mingi': 25, 'Nicholas Bilokapić': 23, 'Sean Raggett': 32, 'Kusini Yengi': 26, 'Andre Dozzell': 26, 'Will Norris': 32,
  // Oxford United
  'Cameron Brannagan': 28, 'Elliott Moore': 28,
  'Jamie Cumming': 26, 'Ciaron Brown': 28, 'James Golding': 22, 'Tyler Goodrham': 23, 'Mark Harris': 27, 'Kyle Joseph': 24, 'Dane Scarlett': 22, 'Sam Winnall': 34, 'Ryan Williams': 33, 'Idris El Mizouni': 25, 'Alex Gorrin': 32, 'Marcus McGuane': 26,
  // Derby County
  'Curtis Nelson': 33, 'Kane Wilson': 25, 'Martyn Waghorn': 36, 'Jerry Yates': 28,
  'Josh Vickers': 30, 'Jacob Widell Zetterström': 28, 'Max Bird': 25, 'Ebou Adams': 30, 'Nathaniel Mendez-Laing': 33, 'Kayden Jackson': 32, 'Tyrese Fornah': 25, 'Eiran Cashin': 23, 'Callum Elder': 30, 'Sonny Bradley': 32,
  // Queens Park Rangers
  'Ilias Chair': 28, 'Jack Colback': 35, 'Charlie Austin': 37, 'Asmir Begović': 38, 'Sam Field': 27,
  'Jimmy Dunne': 28, 'Jake Clarke-Salter': 28, 'Kwame Poku': 25, 'Jake Cooper': 31, 'Murphy Mahoney': 24, 'Joe Walsh': 24, 'Chris Willock': 27, 'Michael Frey': 31, 'Morgan Fox': 32, 'Sean Goss': 30, 'Lucas Andersen': 29, 'Rayhaan Tulloch': 24,
  // Charlton Athletic
  'Alfie May': 32, 'Greg Docherty': 29, 'Miles Leaburn': 21, 'Tom Lockyer': 31,
  'Lloyd Jones': 30, 'Josh Edwards': 26, 'Tyreece Campbell': 22, 'Daniel Kanu': 21, 'Ashley Maynard-Brewer': 27, 'Alfie Doughty': 26, 'Corey Blackett-Taylor': 28, 'Jesurun Rak-Sakyi': 24, 'Naby Sarr': 30, 'Tom Edwards': 26,
  // Wrexham
  'Paul Mullin': 30, 'James McClean': 36, 'Sam Vokes': 36, 'Steven Fletcher': 39,
  'Arthur Okonkwo': 24, 'Max Cleworth': 24, 'Elliot Lee': 31, 'George Dobson': 28, "Eoghan O'Connell": 30, 'Ben Tozer': 34, 'Ollie Palmer': 34, 'Sam Dalby': 25, 'Andy Cannon': 29, 'Aaron Hayden': 28, 'Jordan Tunnicliffe': 30,
  // Birmingham City
  'John Ruddy': 39, 'Krystian Bielik': 27, 'Jay Stansfield': 23, 'Tommy Doyle': 24,
  'Marc Leonard': 24, 'Alex Cochrane': 26, 'Emil Hansson': 28, 'Jordan James': 21, 'Kristian Pedersen': 33,
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
  'Gianluigi Donnarumma': 27, 'Matvey Safonov': 27, 'Arnau Tenas': 25,
  'Achraf Hakimi': 27, 'Marquinhos': 32, 'Willian Pacho': 24, 'Lucas Beraldo': 22, 'Lucas Hernandez': 30,
  'Vitinha': 26, 'Fabián Ruiz': 30, 'Warren Zaïre-Emery': 20, 'Senny Mayulu': 20,
  'Ousmane Dembélé': 29, 'Bradley Barcola': 23, 'Khvicha Kvaratskhelia': 25, 'Gonçalo Ramos': 25, 'Ibrahim Mbaye': 18,
  // Marseille
  'Mason Greenwood': 24,
  'Gerónimo Rulli': 34, 'Jeffrey de Lange': 28,
  'Leonardo Balerdi': 27, 'Derek Cornelius': 28, 'Ulisses Garcia': 30, 'Amir Murillo': 30, 'Nayef Aguerd': 30,
  'Geoffrey Kondogbia': 33, 'Angel Gomes': 25, 'Bilal Nadir': 22,
  'Amine Gouiri': 26, 'Neal Maupay': 29, 'Robinio Vaz': 19,
  // Monaco
  'Denis Zakaria': 28, 'Aleksandr Golovin': 29, 'Folarin Balogun': 24, 'Takumi Minamino': 30,
  'Radosław Majecki': 26, 'Philipp Köhn': 28,
  'Wilfried Singo': 25, 'Thilo Kehrer': 29, 'Christian Mawissa': 21, 'Caio Henrique': 28, 'Jordan Teze': 26,
  'Lamine Camara': 22, 'Eliesse Ben Seghir': 21,
  'George Ilenikhena': 19, 'Mika Biereth': 23,
  // Lyon
  'Corentin Tolisso': 31, 'Alexandre Lacazette': 34, 'Nemanja Matić': 37,
  'Rémy Descamps': 30,
  'Moussa Niakhaté': 30, 'Nicolás Tagliafico': 33, 'Saël Kumbedi': 21, 'Clinton Mata': 33,
  'Tanner Tessmann': 24, 'Pavel Šulc': 25,
  'Malick Fofana': 21, 'Afonso Moreira': 21, 'Ernest Nuamah': 22,
  // Lille
  'Jonathan David': 25, 'Benjamin André': 34,
  'Berke Özer': 26,
  'Alexsandro': 26, 'Aïssa Mandi': 34,
  'Rémy Cabella': 36, 'Nabil Bentaleb': 31, 'Ayyoub Bouaddi': 18,
  'Edon Zhegrova': 27, 'Hákon Haraldsson': 23,
  // Nice
  'Dante': 42, 'Jean-Clair Todibo': 26, 'Terem Moffi': 26,
  'Yehvann Diouf': 26, 'Teddy Boulhendi': 25,
  'Melvin Bard': 25, 'Antoine Mendy': 22, 'Jonathan Clauss': 33,
  'Sofiane Diop': 26, 'Morgan Sanson': 31, 'Hicham Boudaoui': 26, 'Tanguy Ndombele': 29,
  'Badredine Bouanani': 21,
  // Lens
  'Brice Samba': 31, 'Kevin Danso': 27,
  'Yannis Clementia': 26, 'Bingourou Kamara': 22,
  'Facundo Medina': 27, 'Jonathan Gradit': 33, 'Deiver Machado': 32, 'Malang Sarr': 27,
  'Andy Diouf': 23, 'Angelo Fulgini': 30, 'Adrien Thomasson': 32, 'Przemysław Frankowski': 31,
  'Wesley Saïd': 31, 'Florian Sotoca': 35, 'Elye Wahi': 23, 'Neil El Aynaoui': 23,
  // Rennes
  'Steve Mandanda': 41,
  'Gauthier Gallon': 33, 'Sacha-Kelvin Gbem': 19,
  'Lorenz Assignon': 25, 'Christopher Wooh': 24, 'Adrien Truffert': 24, 'Warmed Omari': 24, 'Jeanuël Belocian': 20,
  'Djaoui Cissé': 22, 'Baptiste Santamaria': 30, 'Seko Fofana': 31, 'Alidu Seidu': 26,
  'Ludovic Blas': 28, 'Arnaud Kalimuendo': 24, 'Jonas Martin': 36, 'Fabian Rieder': 24,
  // Strasbourg
  'Habib Diarra': 21, 'Andrey Santos': 21,
  'Alaa Bellaarouch': 22, 'Sacha Delaye': 24, 'Christoph Blaswich': 35,
  'Guela Doué': 23, 'Abakar Sylla': 23, 'Saïdou Sow': 22, 'Thomas Delaine': 33, 'Marvin Senaya': 25,
  'Dilane Bakwa': 23, 'Caleb Wiley': 21,
  'Emanuel Emegha': 23, 'Félix Lemaréchal': 22, 'Sebastián Nanasi': 24, 'Joaquín Panichelli': 23,
  // Toulouse
  'Guillaume Restes': 21,
  'Rasmus Nicolaisen': 29, 'Anthony Rouault': 25,
  'Aron Dønnum': 28, 'Cristian Cásseres': 26,
  'Yann Gboho': 25, 'Frank Magri': 26,
  // Nantes
  'Alban Lafont': 27, 'Moses Simon': 30,
  'Anthony Lopes': 35,
  'Fabien Centonze': 30,
  'Mostafa Mohamed': 28, 'Matthis Abline': 23,
  // Brest
  'Grégoire Coudert': 27,
  'Bradley Locko': 24, 'Lilian Brassier': 26, 'Kenny Lala': 34,
  'Pierre Lees-Melou': 33, 'Mahdi Camara': 28, 'Romain Del Castillo': 30, 'Hugo Magnetti': 28,
  'Ludovic Ajorque': 32, 'Abdallah Sima': 25, 'Jean-Kevin Duverne': 28,
  // Le Havre
  'Josué Casimir': 24,
  // Auxerre
  'Donovan Léon': 33,
  'Sinaly Diomandé': 25, 'Elisha Owusu': 28,
  'Lassine Sinayoko': 26,
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
  'Michael Zetterer': 31, 'Kaua Santos': 23, 'Robin Koch': 30, 'Arthur Theate': 26, 'Nathaniel Brown': 23, 'Aurélio Buta': 29, 'Rasmus Kristensen': 29, 'Hugo Larsson': 22, 'Can Uzun': 20, 'Ellyes Skhiri': 31, 'Fares Chaibi': 23, 'Jonathan Burkardt': 26, 'Ansgar Knauff': 24, 'Michy Batshuayi': 32,
  // VfB Stuttgart
  'Deniz Undav': 28,
  'Alexander Nübel': 29, 'Fabian Bredlow': 31, 'Dennis Seimen': 20, 'Jeff Chabot': 28, 'Ramon Hendriks': 25, 'Josha Vagnoman': 25, 'Julian Chabot': 28, 'Jamie Leweling': 25, 'Angelo Stiller': 25, 'Atakan Karazor': 29, 'Chris Führich': 28, 'Jeremy Sarmiento': 24, 'Ermedin Demirović': 28, 'Tiago Tomás': 24, 'Nick Woltemade': 24,
  // SC Freiburg
  'Vincenzo Grifo': 32, 'Ritsu Doan': 27,
  'Noah Atubolu': 24, 'Florian Müller': 28, 'Benjamin Uphoff': 33, 'Kiliann Sildillia': 24, 'Matthias Ginter': 32, 'Max Rosenfelder': 23, 'Philipp Lienhart': 30, 'Merveille Biankadi': 31, 'Merlin Röhl': 24, 'Yannik Keitel': 26, 'Junior Adamu': 25, 'Michael Gregoritsch': 32, 'Igor Matanović': 23,
  // Mainz 05
  'Robin Zentner': 30, 'Nadiem Amiri': 28,
  'Finn Dahmen': 28, 'Lasse Rieß': 25, 'Andreas Hanche-Olsen': 29, 'Stefan Bell': 34, 'Anthony Caci': 29, 'Maxim Leitsch': 28, 'Danny da Costa': 33, 'Jae-sung Lee': 34, 'Dominik Kohr': 32, 'Nelson Weiper': 21, 'Silas Katompa Mvumpa': 27, 'Kaishu Sano': 25, 'Paul Nebel': 23, 'Marlon Mustapha': 25,
  // Borussia Mönchengladbach
  'Rocco Reitz': 23,
  'Moritz Nicolas': 28, 'Jonas Omlin': 32, 'Jan Olschowsky': 24, 'Ko Itakura': 29, 'Marvin Friedrich': 30, 'Joe Scally': 23, 'Fabio Chiarodia': 21, 'Luca Netz': 23, 'Kevin Stöger': 32, 'Franck Honorat': 30, 'Julian Weigl': 30, 'Robin Hack': 27, 'Tim Kleindienst': 30, 'Nathan Ngoumou': 26, 'Grant-Leon Ranos': 23, 'Haris Tabaković': 32,
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
// Range tightened from an earlier 0.75-1.3 spread: combined with teamFactor
// (itself 0.84-1.20 across every club, see ALL_CLUBS .strength), the old
// range let a weak club's bench player and a big club's star name multiply
// out to the full 0.6-1.5 attribute range and clamp there - which is why
// ratings were landing "some really high, some too low" instead of the
// realistic FC-style spread (most pros 60-82, true 90+ rare) this is meant
// to produce. See attrToRating's anchor table for how avg maps to Overall.
function renownFactor(index, groupLength) {
  if (groupLength <= 1) return 1.05;
  const t = index / (groupLength - 1); // 0 = star name, 1 = fringe/bench name
  return 1.15 - t * 0.35; // roughly 1.15 down to 0.8
}

// Squad lists are ordered star-first, but list order here leans toward
// established seniority rather than current real-world renown - a handful
// of the sport's biggest current young stars aren't actually listed first
// for their club (Lamine Yamal is 3rd of 5 forwards listed at Barcelona
// despite being arguably the club's most valuable player). Deliberately set
// ABOVE renownFactor's own natural 1.15 ceiling, not just up to it - these
// are meant to stand out even from another player who's already 1st-listed
// at a similarly strong club (Jude Bellingham IS Real Madrid's 1st-listed
// midfielder, so without this he and Dani Carvajal - Real Madrid's
// 1st-listed defender - were landing on identical renown and could roll
// either way on Overall, which is how Carvajal ended up occasionally
// outrating him). Not exhaustive - a starting set for the most obvious
// mismatches, easy to extend by name.
const RENOWN_OVERRIDE = {
  'Jude Bellingham': 1.35,
  'Lamine Yamal': 1.35,
  'Jamal Musiala': 1.35,
  'Florian Wirtz': 1.35,
};
function resolveRenownFactor(name, index, groupLength) {
  return RENOWN_OVERRIDE[name] != null ? RENOWN_OVERRIDE[name] : renownFactor(index, groupLength);
}

function makeCareerPlayer(name, group, teamFactor, age) {
  // See POSITION_ATTR_BIAS - same per-position realism as makeSquadPlayer
  // (a striker shouldn't roll centre-back-grade tackling), applied here too
  // since career squads are generated through this function instead.
  const bias = POSITION_ATTR_BIAS[group] || POSITION_ATTR_BIAS.MID;
  const cp = {
    id: careerNextPlayerId++,
    name, group, age,
    pace: clamp(rand(0.85, 1.15) * teamFactor * bias.pace, 0.6, 1.5),
    tackling: clamp(rand(0.85, 1.15) * teamFactor * bias.tackling, 0.6, 1.5),
    finishing: clamp(rand(0.85, 1.15) * teamFactor * bias.finishing, 0.6, 1.5),
    reflexes: clamp(rand(0.85, 1.15) * teamFactor, 0.6, 1.5),
    passing: clamp(rand(0.85, 1.15) * teamFactor * bias.passing, 0.6, 1.5),
    dribbling: clamp(rand(0.85, 1.15) * teamFactor * bias.dribbling, 0.6, 1.5),
    strength: clamp(rand(0.85, 1.15) * teamFactor * bias.strength, 0.6, 1.5),
    // Not teamFactor-scaled - see the makeSquadPlayer comment on the same
    // field, same reasoning applies to career players.
    staminaRating: clamp(rand(0.6, 1.5), 0.6, 1.5),
  };
  const avg = (cp.pace + cp.tackling + cp.finishing + cp.reflexes) / 4;
  cp.potential = age < 24 ? clamp(avg + rand(0.05, 0.3), avg, 1.5) : avg;
  cp.value = computePlayerValue(cp);
  cp.wage = computePlayerWage(cp);
  // Whatever's left on their current deal - a freshly-generated club player
  // (never actually negotiated with) just gets a plausible remaining length,
  // same idea as everything else about them being rolled rather than real
  // history. Longer for younger players (clubs tie up prospects for longer).
  cp.contractYears = Math.floor(rand(age < 24 ? 3 : 1, age < 24 ? 6 : 4));
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
      squad.push(makeCareerPlayer(name, group, teamFactor * resolveRenownFactor(name, i, names.length), resolvePlayerAge(name, 18, 34)));
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
    cp.wage = computePlayerWage(cp);
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

// ============================================================
// Main menu mode browser - one full-screen themed page per mode, browsed by
// arrow keys/swipe rather than a grid of buttons (see index.html's
// #mode-browser-track). Each page's actual "enter this mode" action is
// exactly what its old main-menu button used to do - see selectModePage.
// ============================================================
let modeBrowserIdx = 0;
let modeTipTimer = null;
let modeTipIdx = 0;

const MODE_PAGES = [
  {
    key: 'play', screen: 'setup-screen',
    tips: [
      'Ranks run from Bronze all the way up to the brand new Invincible tier - each one plays sharper and closes you down harder.',
      "Push into the final third and your whole team gets a pace boost - defend your own and you get a tackling boost instead.",
      'Rain skids the ball further but adds wobble to every pass - the best passers still hold up best in the wet.',
      'Use the small league arrows next to each team box to jump straight to a division instead of cycling every club one by one.',
    ],
  },
  {
    key: 'season', screen: 'season-setup-screen',
    tips: [
      "The league table simulates round-by-round as you play, using your own real result for your own fixture.",
      'Momentum swings after a goal - score early and the next few minutes get a little easier.',
      "Every player now has a 1-99 rating and six sub-stats - check a signing's numbers before you rely on them.",
      'A wet pitch adds pass wobble on top of whatever your passers can already handle - watch the weather.',
    ],
  },
  {
    key: 'cup', screen: 'cup-setup-screen',
    tips: [
      'Penalty shootouts are close to a real coin flip - just a small nudge toward the stronger side, nothing more.',
      'Corners can now be aimed and shot straight at goal, not just auto-crossed to the nearest teammate.',
      'A pressing defender can actually catch a dribble now instead of just trailing behind you forever.',
      'Momentum swings hard in a one-off tie - concede early and the pressure is real for the rest of the match.',
    ],
  },
  {
    key: 'career',
    onSelect: () => { renderCareerSlotsScreen(); showScreen('career-slots-screen'); },
    tips: [
      'Transfers are a real negotiation now - agree a fee, then haggle over wages and contract length separately.',
      'Every player has an independent Stamina rating - a big name can still be a poor fitness prospect.',
      'Contracts run down every season - renew a player before it hits zero or they leave for nothing.',
      'Elite young prospects are priced and rated to match real scouting reports, not just squad-list position.',
    ],
  },
  {
    key: 'online', screen: 'online-menu-screen',
    tips: [
      'A dropped connection mid-match now tries to reconnect automatically before giving up for good.',
      'Quick Match skips the room code entirely - it pairs you with whoever else is searching right now.',
      'Each side picks their own club and league independently before kickoff.',
      'Still want a code with a friend? Host and Join work exactly like before, right alongside Quick Match.',
    ],
  },
];

// ---------- Mode page abstract background lines ----------
// A handful of large, soft, randomised curved strokes (in the page's own
// --accent colour via CSS) sat behind the illustrated scenes - a gentle
// ambient backdrop rather than a literal texture. The drifting/rotating is
// pure CSS (see .mode-abstract-bg/@keyframes mode-abstract-flow); this just
// builds the underlying paths once, oversized and looping past the visible
// edges (viewBox bleeds beyond 0..520) so the slow drift never reveals a
// hard edge or a repeat seam.
const ABSTRACT_LINE_COUNT = 4;
function renderModeAbstractLines(container) {
  if (!container) return;
  const paths = [];
  for (let i = 0; i < ABSTRACT_LINE_COUNT; i++) {
    const y0 = rand(-80, 600), y1 = rand(-80, 600), y2 = rand(-80, 600);
    const cx1 = rand(50, 280), cx2 = rand(240, 470);
    const width = (2.5 + i * 1.3).toFixed(1);
    paths.push(`<path d="M -100 ${y0.toFixed(0)} C ${cx1.toFixed(0)} ${y1.toFixed(0)}, ${cx2.toFixed(0)} ${y2.toFixed(0)}, 620 ${rand(-80, 600).toFixed(0)}" stroke-width="${width}" opacity="${(0.5 - i * 0.09).toFixed(2)}" />`);
  }
  container.innerHTML = `<svg viewBox="0 0 520 520" preserveAspectRatio="none">${paths.join('')}</svg>`;
}

// Portraits are drawn once (static art, not an animated scene) using the
// game's own retro player-sprite renderer (drawPlayerSprite, the same
// function that draws every on-pitch player) at a larger scale, in real
// club kit colours pulled from ALL_CLUBS - no photo assets needed or used.
// Internal draw-buffer resolution only (crispness at any DPI) - the actual
// displayed size is fully responsive, driven by CSS (.mode-collage canvas's
// width:100% + aspect-ratio, matching this same W:H ratio), so the strip
// can freely resize across breakpoints with zero stretch/distortion.
const COLLAGE_TILE_W = 190, COLLAGE_TILE_H = 270, COLLAGE_SPRITE_SCALE = 8.4, COLLAGE_TILE_COUNT = 14;
function renderModeCollage(container) {
  if (!container) return;
  container.innerHTML = '';
  const dpr = window.devicePixelRatio || 1;
  for (let i = 0; i < COLLAGE_TILE_COUNT; i++) {
    const canvas = document.createElement('canvas');
    canvas.width = COLLAGE_TILE_W * dpr;
    canvas.height = COLLAGE_TILE_H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr * COLLAGE_SPRITE_SCALE, dpr * COLLAGE_SPRITE_SCALE);
    const club = ALL_CLUBS[Math.floor(Math.random() * ALL_CLUBS.length)];
    const skinTone = SKIN_TONES[Math.floor(Math.random() * SKIN_TONES.length)];
    const hairColor = HAIR_COLORS[Math.floor(Math.random() * HAIR_COLORS.length)];
    const stridePhase = Math.random() < 0.5 ? null : rand(0, Math.PI * 2);
    const cx = COLLAGE_TILE_W / (2 * COLLAGE_SPRITE_SCALE);
    const cy = COLLAGE_TILE_H / (2 * COLLAGE_SPRITE_SCALE) + 2;
    drawPlayerSprite(ctx, cx, cy, club.shirt, club.shorts, false, stridePhase, skinTone, hairColor, club.stripe);
    container.appendChild(canvas);
  }
}

// ---------- Mode page background scenes ----------
// A moving, illustrated alternative to a single flat icon - built from the
// same sprite/shape primitives as the rest of the game (drawPlayerSprite,
// drawRegularPolygon for the ball/stars/formation), not photos. Each mode
// has TWO distinct scene designs (not just the same layout re-rolled with
// different colours) - see MODE_SCENE_VARIANTS - so the background genuinely
// cycles between different compositions, not just different players.
// Everything is drawn once per layer (MODE_SCENE_LAYERS canvases per page);
// the drifting/fading is pure CSS (see .mode-scene-layer/@keyframes
// mode-scene-flow) so nothing here needs to re-render per frame.
const MODE_SCENE_LAYERS = 3;
const SCENE_W = 520, SCENE_H = 520;
const MODE_SCENE_ANIM_SEC = 26; // must match the CSS animation-duration

function randomClub() { return ALL_CLUBS[Math.floor(Math.random() * ALL_CLUBS.length)]; }
function randomSkinTone() { return SKIN_TONES[Math.floor(Math.random() * SKIN_TONES.length)]; }
function randomHairColor() { return HAIR_COLORS[Math.floor(Math.random() * HAIR_COLORS.length)]; }

// Places one drawPlayerSprite (whose own coordinate space is tiny, roughly
// -5..5 units) at (x,y) in scene-space at a given pixel scale. clubOverride
// lets a scene put two players in the SAME kit (e.g. a "vs" face-off between
// two different clubs, chosen once by the caller) instead of always random.
function placeScenePlayer(ctx, x, y, scale, stridePhase, clubOverride) {
  const club = clubOverride || randomClub();
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  drawPlayerSprite(ctx, 0, 0, club.shirt, club.shorts, false, stridePhase, randomSkinTone(), randomHairColor(), club.stripe);
  ctx.restore();
}

function drawSceneBall(ctx, x, y, r) {
  ctx.save();
  ctx.fillStyle = '#f2f2f2';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = Math.max(1, r * 0.05);
  ctx.stroke();
  ctx.fillStyle = 'rgba(20,20,20,0.85)';
  drawRegularPolygon(ctx, x, y, r * 0.42, 5, -Math.PI / 2);
  ctx.restore();
}

// A packed stadium crowd - a band of small alternating-tone blocks, same
// idea as the in-match crowd rendering, just simplified for a small scene.
function drawSceneCrowd(ctx, x, y, w, h, rows) {
  const tones = ['rgba(255,255,255,0.09)', 'rgba(255,255,255,0.16)', 'rgba(255,255,255,0.06)', 'rgba(255,255,255,0.12)'];
  const cols = Math.max(1, Math.round(w / 11));
  const colW = w / cols, rowH = h / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      ctx.fillStyle = tones[(r * 7 + c * 3) % tones.length];
      ctx.fillRect(x + c * colW, y + r * rowH, colW - 1.5, rowH - 1.5);
    }
  }
}

// A soft warm floodlight glow, same idea as the real match's drawFloodlights.
function drawSceneFloodlight(ctx, x, y, radius) {
  ctx.save();
  const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
  glow.addColorStop(0, 'rgba(255,244,214,0.32)');
  glow.addColorStop(1, 'rgba(255,244,214,0)');
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, SCENE_W, SCENE_H);
  ctx.restore();
}

// A diagonal mown-grass stripe band, clipped to a rect - same idea as the
// real pitch texture, just for a scene's own patch of grass.
function drawSceneGrass(ctx, x, y, w, h) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fillRect(x, y, w, h);
  const stripeW = 26;
  let i = 0;
  for (let sx = x - h; sx < x + w + h; sx += stripeW) {
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
    ctx.beginPath();
    ctx.moveTo(sx, y + h);
    ctx.lineTo(sx + h, y);
    ctx.lineTo(sx + h + stripeW, y);
    ctx.lineTo(sx + stripeW, y + h);
    ctx.closePath();
    ctx.fill();
    i++;
  }
  ctx.restore();
}

// ---------- Kick-Off ----------
// A: close-up goal mouth - proper straight-grid net (each strand runs
// top-to-bottom at its OWN x, never converging on one point - an earlier
// version curved every vertical strand toward a single spot, which read as
// a broken/warped net), side netting for a bit of real depth, a corner
// flag, crowd behind the bar, floodlight glow, two players and the ball.
function drawKickoffSceneGoal(ctx) {
  ctx.clearRect(0, 0, SCENE_W, SCENE_H);
  drawSceneFloodlight(ctx, 260, 40, 260);
  drawSceneCrowd(ctx, 40, 30, 440, 26, 3);
  drawSceneGrass(ctx, 40, 380, 440, 100);
  const fx0 = 70, fx1 = 450, fy0 = 70, fy1 = 280;
  // side netting - simple trapezoids flaring out behind each post, just
  // enough to suggest the net has real depth rather than being a flat backdrop
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath(); ctx.moveTo(fx0, fy0); ctx.lineTo(fx0 - 22, fy0 + 14); ctx.lineTo(fx0 - 22, fy1 - 14); ctx.lineTo(fx0, fy1); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(fx1, fy0); ctx.lineTo(fx1 + 22, fy0 + 14); ctx.lineTo(fx1 + 22, fy1 - 14); ctx.lineTo(fx1, fy1); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 7;
  ctx.strokeRect(fx0, fy0, fx1 - fx0, fy1 - fy0);
  // net - a plain straight grid, exactly the same shape convention as the
  // real in-match goal net (see drawPitchMarkings) so it always reads as a
  // normal net rather than anything warped
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  for (let x = fx0; x <= fx1; x += 24) { ctx.beginPath(); ctx.moveTo(x, fy0); ctx.lineTo(x, fy1); ctx.stroke(); }
  for (let y = fy0; y <= fy1; y += 22) { ctx.beginPath(); ctx.moveTo(fx0, y); ctx.lineTo(fx1, y); ctx.stroke(); }
  placeScenePlayer(ctx, 195, 335, 11.5, rand(0, Math.PI * 2));
  placeScenePlayer(ctx, 335, 375, 11.5, rand(0, Math.PI * 2));
  // a puff of dust at the ball's contact point and a couple of fading
  // "just moved" ghost circles for a sense of motion
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  [[300, 312, 6], [285, 316, 4]].forEach(([gx, gy, gr]) => { ctx.beginPath(); ctx.arc(gx, gy, gr, 0, Math.PI * 2); ctx.fill(); });
  drawSceneBall(ctx, 260, 300, 21);
  ctx.fillStyle = 'rgba(120,90,50,0.35)';
  [0, 1, 2].forEach((i) => { ctx.beginPath(); ctx.arc(255 + i * 6, 322 + i * 2, 3 - i * 0.6, 0, Math.PI * 2); ctx.fill(); });
}
// B: overhead kickoff formation - full pitch markings both ends, corner
// arcs, a referee, attacking-direction arrows for each club, two clubs
// squared up over the ball at the centre spot, crowd top and bottom.
function drawKickoffSceneFormation(ctx) {
  ctx.clearRect(0, 0, SCENE_W, SCENE_H);
  drawSceneGrass(ctx, 40, 60, 440, 400);
  drawSceneCrowd(ctx, 40, 20, 440, 24, 2);
  drawSceneCrowd(ctx, 40, 480, 440, 24, 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 4;
  ctx.strokeRect(40, 60, 440, 400);
  ctx.beginPath(); ctx.moveTo(40, 260); ctx.lineTo(480, 260); ctx.stroke();
  ctx.beginPath(); ctx.arc(260, 260, 55, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeRect(190, 60, 140, 18);
  ctx.strokeRect(190, 422, 140, 18);
  ctx.strokeRect(150, 60, 220, 46);
  ctx.strokeRect(150, 394, 220, 46);
  ctx.lineWidth = 2;
  [[40, 60], [480, 60], [40, 460], [480, 460]].forEach(([x, y]) => {
    ctx.beginPath();
    const startAngle = x === 40 ? (y === 60 ? 0 : -Math.PI / 2) : (y === 60 ? Math.PI / 2 : Math.PI);
    ctx.arc(x, y, 14, startAngle, startAngle + Math.PI / 2);
    ctx.stroke();
  });
  // attacking-direction arrows, one either side, pointing at the opposite goal
  const drawArrow = (x, y, dir) => {
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y - 16 * dir); ctx.lineTo(x, y + 16 * dir); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 5, y + 8 * dir); ctx.lineTo(x, y + 16 * dir); ctx.lineTo(x + 5, y + 8 * dir); ctx.stroke();
  };
  drawArrow(110, 340, -1);
  drawArrow(410, 180, 1);
  const clubA = randomClub(), clubB = randomClub();
  placeScenePlayer(ctx, 230, 230, 10, null, clubA);
  placeScenePlayer(ctx, 290, 290, 10, null, clubB);
  // referee, off to one side
  placeScenePlayer(ctx, 260, 350, 8, null, { shirt: '#1a1a1a', shorts: '#1a1a1a' });
  drawSceneBall(ctx, 260, 260, 16);
}

// ---------- Season ----------
// A: league table - header row, position numbers, club-colour chips, a
// movement indicator (up/down/level) per row, points column, gold/silver/
// bronze leaders, a small trophy for the title spot.
function drawSeasonSceneTable(ctx) {
  ctx.clearRect(0, 0, SCENE_W, SCENE_H);
  const rows = 7, rowH = 32, top = 106, left = 70, w = 380;
  const rankColors = ['rgba(250,204,21,0.75)', 'rgba(203,213,225,0.6)', 'rgba(205,127,50,0.6)'];
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(left, top - 24, w, 20);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = 'bold 10px sans-serif';
  ['#', 'CLUB', 'P', 'GD', 'PTS'].forEach((label, i) => {
    ctx.fillText(label, left + [10, 60, w - 150, w - 105, w - 55][i], top - 10);
  });
  for (let i = 0; i < rows; i++) {
    const club = randomClub();
    const y = top + i * rowH;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.05)';
    ctx.fillRect(left, y, w, rowH - 4);
    ctx.fillStyle = rankColors[i] || 'rgba(255,255,255,0.4)';
    ctx.fillRect(left + 6, y + 4, 20, rowH - 12);
    ctx.fillStyle = club.shirt;
    ctx.fillRect(left + 36, y + (rowH - 4) / 2 - 8, 16, 16);
    ctx.fillStyle = 'rgba(255,255,255,0.32)';
    ctx.fillRect(left + 62, y + (rowH - 4) / 2 - 3, w - 210, 6);
    // movement indicator - a small filled triangle up/down, or a flat dash
    ctx.fillStyle = i < 3 ? 'rgba(74,222,128,0.85)' : i > 4 ? 'rgba(248,113,113,0.85)' : 'rgba(255,255,255,0.4)';
    const mx = left + w - 150, my = y + (rowH - 4) / 2;
    if (i < 3) { ctx.beginPath(); ctx.moveTo(mx, my + 5); ctx.lineTo(mx + 5, my - 5); ctx.lineTo(mx + 10, my + 5); ctx.closePath(); ctx.fill(); }
    else if (i > 4) { ctx.beginPath(); ctx.moveTo(mx, my - 5); ctx.lineTo(mx + 5, my + 5); ctx.lineTo(mx + 10, my - 5); ctx.closePath(); ctx.fill(); }
    else ctx.fillRect(mx, my - 1, 10, 2);
    ctx.fillStyle = i === 0 ? 'rgba(250,204,21,0.85)' : 'rgba(255,255,255,0.5)';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText(String(94 - i * 6), left + w - 60, y + (rowH - 4) / 2 + 4);
  }
  // small trophy marker beside the title spot
  ctx.fillStyle = 'rgba(250,204,21,0.8)';
  drawRegularPolygon(ctx, left + w + 20, top + rowH / 2, 9, 5, -Math.PI / 2);
  ctx.font = '10px sans-serif';
}
// B: fixture list - a matchday header tab, upcoming "vs" rows with a score
// box, club initials, the next match highlighted, a competition badge.
function drawSeasonSceneFixtures(ctx) {
  ctx.clearRect(0, 0, SCENE_W, SCENE_H);
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fillRect(90, 56, 340, 30);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('MATCHDAY ' + Math.floor(rand(6, 30)), 102, 76);
  ctx.fillStyle = 'rgba(59,130,246,0.7)';
  ctx.beginPath(); ctx.arc(410, 71, 9, 0, Math.PI * 2); ctx.fill();
  const rows = 5, rowH = 44, top = 106, left = 90, w = 340;
  for (let i = 0; i < rows; i++) {
    const highlight = i === 1;
    const y = top + i * rowH;
    ctx.fillStyle = highlight ? 'rgba(59,130,246,0.3)' : (i % 2 === 0 ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.04)');
    ctx.fillRect(left, y, w, rowH - 6);
    if (highlight) { ctx.strokeStyle = 'rgba(96,165,250,0.7)'; ctx.lineWidth = 1.5; ctx.strokeRect(left, y, w, rowH - 6); }
    const clubA = randomClub(), clubB = randomClub();
    ctx.fillStyle = clubA.shirt;
    ctx.fillRect(left + 12, y + (rowH - 6) / 2 - 7, 14, 14);
    ctx.fillStyle = clubB.shirt;
    ctx.fillRect(left + w - 26, y + (rowH - 6) / 2 - 7, 14, 14);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '9px sans-serif';
    ctx.fillText(clubA.name.slice(0, 3).toUpperCase(), left + 30, y + (rowH - 6) / 2 + 3);
    ctx.textAlign = 'right';
    ctx.fillText(clubB.name.slice(0, 3).toUpperCase(), left + w - 30, y + (rowH - 6) / 2 + 3);
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText(i < 2 ? `${Math.floor(rand(0, 4))} - ${Math.floor(rand(0, 4))}` : 'vs', left + w / 2, y + (rowH - 6) / 2 + 5);
  }
  ctx.textAlign = 'left';
}

// ---------- Cup ----------
// A: the trophy itself - gradient bowl, handles, ribbon, engraved plaque,
// shine, varied confetti (rects + streamers), a spotlight cone plus glow.
function drawCupSceneTrophy(ctx) {
  ctx.clearRect(0, 0, SCENE_W, SCENE_H);
  drawSceneFloodlight(ctx, 260, 220, 240);
  // spotlight cone from directly above
  ctx.save();
  const cone = ctx.createLinearGradient(260, 0, 260, 260);
  cone.addColorStop(0, 'rgba(255,255,255,0.16)');
  cone.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = cone;
  ctx.beginPath(); ctx.moveTo(260, 0); ctx.lineTo(160, 260); ctx.lineTo(360, 260); ctx.closePath(); ctx.fill();
  ctx.restore();
  const cx = 260, baseY = 400;
  const grad = ctx.createLinearGradient(cx - 90, 0, cx + 90, 0);
  grad.addColorStop(0, '#8a6d1f'); grad.addColorStop(0.5, '#f5d060'); grad.addColorStop(1, '#8a6d1f');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(cx - 80, 140);
  ctx.quadraticCurveTo(cx - 90, 260, cx - 30, 300);
  ctx.lineTo(cx + 30, 300);
  ctx.quadraticCurveTo(cx + 90, 260, cx + 80, 140);
  ctx.closePath(); ctx.fill();
  ctx.lineWidth = 16; ctx.strokeStyle = grad;
  ctx.beginPath(); ctx.arc(cx - 95, 190, 34, Math.PI * 0.3, Math.PI * 1.5); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx + 95, 190, 34, Math.PI * 1.5, Math.PI * 1.7); ctx.stroke();
  // ribbon draped across the bowl
  ctx.fillStyle = 'rgba(220,38,38,0.85)';
  ctx.save();
  ctx.translate(cx, 190);
  ctx.rotate(-0.25);
  ctx.fillRect(-45, -8, 90, 16);
  ctx.restore();
  ctx.fillRect(cx - 10, 300, 20, 50);
  ctx.beginPath();
  ctx.moveTo(cx - 55, 350); ctx.lineTo(cx + 55, 350); ctx.lineTo(cx + 75, baseY); ctx.lineTo(cx - 75, baseY);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(90,60,10,0.6)';
  ctx.fillRect(cx - 30, baseY - 8, 60, 14);
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.font = 'bold 7px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('CHAMPIONS', cx, baseY - 1);
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillRect(cx - 55, 150, 10, 130);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  [[cx - 40, 100], [cx, 78], [cx + 40, 100]].forEach(([sx, sy]) => drawRegularPolygon(ctx, sx, sy, 8, 5, -Math.PI / 2));
  // confetti - a mix of little rects and longer streamer strips
  const confettiColors = ['#f43f5e', '#3b82f6', '#eab308', '#22c55e', '#a78bfa'];
  for (let i = 0; i < 28; i++) {
    ctx.fillStyle = confettiColors[i % confettiColors.length];
    ctx.save();
    ctx.translate(rand(40, 480), rand(40, 460));
    ctx.rotate(rand(0, Math.PI * 2));
    if (i % 5 === 0) ctx.fillRect(-2, -14, 4, 28); else ctx.fillRect(-3, -5, 6, 10);
    ctx.restore();
  }
}
// B: knockout bracket - round labels, four quarterfinal slots narrowing
// through the lines to a single winner at the final, club-colour chips
// with score marks at each node, a small trophy over the champion.
function drawCupSceneBracket(ctx) {
  ctx.clearRect(0, 0, SCENE_W, SCENE_H);
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 2;
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = 'bold 10px sans-serif';
  ['QF', 'SF', 'F'].forEach((label, i) => ctx.fillText(label, 60 + i * 100 + 20, 50));
  const slotYs = [90, 160, 260, 330];
  const chipX = 60;
  slotYs.forEach((y) => {
    const club = randomClub();
    ctx.fillStyle = club.shirt;
    ctx.fillRect(chipX, y - 8, 60, 16);
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.strokeRect(chipX, y - 8, 60, 16);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '9px sans-serif';
    ctx.fillText(String(Math.floor(rand(0, 4))), chipX + 66, y + 4);
  });
  // quarter -> semi
  [[90, 160, 220], [260, 330, 295]].forEach(([yA, yB, semiY]) => {
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.beginPath(); ctx.moveTo(chipX + 60, yA); ctx.lineTo(chipX + 100, yA); ctx.lineTo(chipX + 100, semiY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(chipX + 60, yB); ctx.lineTo(chipX + 100, yB); ctx.lineTo(chipX + 100, semiY); ctx.stroke();
    const semiClub = randomClub();
    ctx.fillStyle = semiClub.shirt;
    ctx.fillRect(chipX + 100, semiY - 8, 60, 16);
    ctx.strokeRect(chipX + 100, semiY - 8, 60, 16);
  });
  // semi -> final
  ctx.beginPath(); ctx.moveTo(chipX + 160, 220); ctx.lineTo(chipX + 220, 220); ctx.lineTo(chipX + 220, 258); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(chipX + 160, 295); ctx.lineTo(chipX + 220, 295); ctx.lineTo(chipX + 220, 258); ctx.stroke();
  const finalClub = randomClub();
  ctx.fillStyle = 'rgba(250,204,21,0.25)';
  ctx.fillRect(chipX + 210, 240, 90, 36);
  ctx.fillStyle = finalClub.shirt;
  ctx.fillRect(chipX + 220, 250, 70, 16);
  ctx.strokeStyle = 'rgba(250,204,21,0.8)';
  ctx.strokeRect(chipX + 210, 240, 90, 36);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  drawRegularPolygon(ctx, chipX + 255, 218, 10, 5, -Math.PI / 2);
}

// ---------- Career ----------
// A: tactics board - full pitch markings (goal boxes, corner arcs, centre
// circle), role-coloured formation dots, a curved run arrow, an attacking-
// direction arrow, a clipboard frame around the whole board, two players
// stood in front reviewing it.
function drawCareerSceneBoard(ctx) {
  ctx.clearRect(0, 0, SCENE_W, SCENE_H);
  // clipboard frame
  ctx.fillStyle = 'rgba(101,67,33,0.5)';
  ctx.fillRect(55, 45, 410, 290);
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.fillRect(230, 38, 60, 16);
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 5;
  ctx.strokeRect(70, 60, 380, 260);
  ctx.beginPath(); ctx.moveTo(260, 60); ctx.lineTo(260, 320); ctx.stroke();
  ctx.beginPath(); ctx.arc(260, 190, 48, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeRect(70, 140, 30, 100);
  ctx.strokeRect(420, 140, 30, 100);
  ctx.lineWidth = 3;
  [[70, 60], [70, 320], [450, 60], [450, 320]].forEach(([x, y]) => {
    ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.stroke();
  });
  const formation = [
    { x: 100, y: 190, role: 'GK' }, { x: 160, y: 110, role: 'DEF' }, { x: 160, y: 270, role: 'DEF' },
    { x: 260, y: 90, role: 'MID' }, { x: 260, y: 290, role: 'MID' },
    { x: 380, y: 130, role: 'FWD' }, { x: 380, y: 250, role: 'FWD' },
  ];
  formation.forEach(({ x, y, role }) => {
    ctx.fillStyle = POSITION_COLOR[role] || 'rgba(255,255,255,0.55)';
    ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1.5; ctx.stroke();
  });
  // a dashed run arrow, one midfielder pushing forward into space
  ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2;
  ctx.setLineDash([5, 5]);
  ctx.beginPath(); ctx.moveTo(260, 90); ctx.quadraticCurveTo(330, 70, 375, 128); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.beginPath(); ctx.moveTo(375, 128); ctx.lineTo(366, 118); ctx.lineTo(368, 132); ctx.closePath(); ctx.fill();
  placeScenePlayer(ctx, 210, 400, 10.5, null);
  placeScenePlayer(ctx, 320, 410, 10.5, null);
}
// B: transfer negotiation - a contract document (with a second paper
// stacked behind it) with a round club-crest badge, signature line and
// pen, a stack of budget bars with a value label, a calendar tab for
// contract length - Career's business side.
function drawCareerSceneContract(ctx) {
  ctx.clearRect(0, 0, SCENE_W, SCENE_H);
  const club = randomClub();
  // a second paper peeking out behind, for a little real depth
  ctx.save();
  ctx.translate(196, 250);
  ctx.rotate(0.1);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillRect(-90, -130, 180, 240);
  ctx.restore();
  ctx.save();
  ctx.translate(180, 240);
  ctx.rotate(-0.06);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillRect(-90, -130, 180, 240);
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 2;
  ctx.strokeRect(-90, -130, 180, 240);
  // round club-crest badge instead of a plain square, with initials
  ctx.fillStyle = club.shirt;
  ctx.beginPath(); ctx.arc(0, -80, 30, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(club.name.slice(0, 2).toUpperCase(), 0, -79);
  ctx.textBaseline = 'alphabetic';
  ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 3;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath(); ctx.moveTo(-70, 0 + i * 24); ctx.lineTo(70, 0 + i * 24); ctx.stroke();
  }
  // signature squiggle
  ctx.strokeStyle = 'rgba(30,60,150,0.8)'; ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(-55, 96);
  ctx.bezierCurveTo(-30, 70, -10, 120, 10, 90);
  ctx.bezierCurveTo(30, 65, 45, 110, 60, 96);
  ctx.stroke();
  ctx.restore();
  // pen
  ctx.save();
  ctx.translate(300, 340);
  ctx.rotate(-0.7);
  ctx.fillStyle = '#1f2937';
  ctx.fillRect(-6, -70, 12, 90);
  ctx.fillStyle = '#eab308';
  ctx.beginPath(); ctx.moveTo(-6, -70); ctx.lineTo(6, -70); ctx.lineTo(0, -90); ctx.closePath(); ctx.fill();
  ctx.restore();
  // budget bars + value label
  const barX = 340, barBase = 400;
  [70, 100, 130].forEach((h, i) => {
    ctx.fillStyle = i === 2 ? 'rgba(34,197,94,0.7)' : 'rgba(34,197,94,0.4)';
    ctx.fillRect(barX + i * 26, barBase - h, 18, h);
  });
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('£' + Math.floor(rand(20, 90)) + 'm', barX + 26, barBase - 145);
  ctx.textAlign = 'left';
  // small calendar tab for contract length
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(barX - 4, 120, 46, 40);
  ctx.fillStyle = 'rgba(220,38,38,0.85)';
  ctx.fillRect(barX - 4, 120, 46, 10);
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(String(Math.floor(rand(2, 5))), barX + 19, 148);
  ctx.font = '7px sans-serif';
  ctx.fillText('YRS', barX + 19, 128);
  ctx.textAlign = 'left';
}

// ---------- Online ----------
// A: connected globe - lat/long lines, scattered surface dots (a rough
// "world map" feel), glowing linked nodes with static ping rings around a
// central one (you), an outer atmosphere glow.
function drawOnlineSceneGlobe(ctx) {
  ctx.clearRect(0, 0, SCENE_W, SCENE_H);
  const cx = 260, cy = 220, r = 155;
  // outer atmosphere glow
  ctx.save();
  const atmo = ctx.createRadialGradient(cx, cy, r * 0.85, cx, cy, r * 1.35);
  atmo.addColorStop(0, 'rgba(167,139,250,0.22)');
  atmo.addColorStop(1, 'rgba(167,139,250,0)');
  ctx.fillStyle = atmo;
  ctx.fillRect(cx - r * 1.4, cy - r * 1.4, r * 2.8, r * 2.8);
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.ellipse(cx, cy, r, r * (i / 4), 0, 0, Math.PI * 2); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy); ctx.stroke();
  // scattered "landmass" dots across the surface
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  for (let i = 0; i < 30; i++) {
    const a = rand(0, Math.PI * 2), rr = rand(0, r * 0.95);
    const ex = cx + Math.cos(a) * rr, ey = cy + Math.sin(a) * rr * 0.5;
    ctx.beginPath(); ctx.arc(ex, ey, rand(1.5, 3), 0, Math.PI * 2); ctx.fill();
  }
  const nodes = [
    [cx - r * 0.6, cy - r * 0.5], [cx + r * 0.7, cy - r * 0.2], [cx - r * 0.3, cy + r * 0.7],
    [cx + r * 0.4, cy + r * 0.6], [cx - r * 0.8, cy + r * 0.1], [cx + r * 0.75, cy + r * 0.45],
  ];
  ctx.strokeStyle = 'rgba(167,139,250,0.65)'; ctx.lineWidth = 2;
  nodes.forEach(([x, y]) => { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke(); });
  nodes.forEach(([x, y]) => {
    ctx.save();
    const glow = ctx.createRadialGradient(x, y, 0, x, y, 18);
    glow.addColorStop(0, 'rgba(167,139,250,0.55)');
    glow.addColorStop(1, 'rgba(167,139,250,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x - 18, y - 18, 36, 36);
    ctx.restore();
    ctx.fillStyle = 'rgba(196,181,253,0.95)';
    ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill();
  });
  // static "ping" rings around the central node, three stages frozen at once
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.5;
  [16, 26, 36].forEach((rr) => { ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke(); });
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath(); ctx.arc(cx, cy, 11, 0, Math.PI * 2); ctx.fill();
}
// B: head-to-head - two players from different clubs facing off in front
// of a crowd band, club badges over each, a "VS" badge between them with
// a live connection strength readout, signal bars, a connecting line.
function drawOnlineSceneVersus(ctx) {
  ctx.clearRect(0, 0, SCENE_W, SCENE_H);
  drawSceneCrowd(ctx, 40, 40, 440, 30, 3);
  drawSceneGrass(ctx, 40, 340, 440, 130);
  const clubA = randomClub(), clubB = randomClub();
  ctx.strokeStyle = 'rgba(167,139,250,0.5)'; ctx.lineWidth = 3;
  ctx.setLineDash([6, 6]);
  ctx.beginPath(); ctx.moveTo(150, 260); ctx.lineTo(370, 260); ctx.stroke();
  ctx.setLineDash([]);
  [[160, clubA], [360, clubB]].forEach(([x, club]) => {
    ctx.fillStyle = club.shirt;
    ctx.beginPath(); ctx.arc(x, 175, 18, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2; ctx.stroke();
  });
  placeScenePlayer(ctx, 160, 300, 13, null, clubA);
  placeScenePlayer(ctx, 360, 300, 13, null, clubB);
  // VS badge
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath(); ctx.arc(260, 260, 34, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('VS', 260, 262);
  ctx.font = 'bold 9px sans-serif';
  ctx.fillStyle = 'rgba(74,222,128,0.9)';
  ctx.fillText('LIVE', 260, 190);
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  // signal bars above each player
  [160, 360].forEach((x) => {
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = 'rgba(74,222,128,0.8)';
      ctx.fillRect(x - 20 + i * 11, 130 - i * 6, 7, 8 + i * 6);
    }
  });
}

const MODE_SCENE_VARIANTS = {
  play: [drawKickoffSceneGoal, drawKickoffSceneFormation],
  season: [drawSeasonSceneTable, drawSeasonSceneFixtures],
  cup: [drawCupSceneTrophy, drawCupSceneBracket],
  career: [drawCareerSceneBoard, drawCareerSceneContract],
  online: [drawOnlineSceneGlobe, drawOnlineSceneVersus],
};

// Renders MODE_SCENE_LAYERS canvases into a page's .mode-scene-bg, cycling
// through that mode's different scene designs (not just re-rolling the same
// one) and staggering each by a negative animation-delay so they're always
// mid-cycle at different points - one drifting out as the next drifts in.
function renderModeSceneLayers(container, modeKey) {
  if (!container) return;
  container.innerHTML = '';
  const variants = MODE_SCENE_VARIANTS[modeKey];
  if (!variants || !variants.length) return;
  const dpr = window.devicePixelRatio || 1;
  for (let i = 0; i < MODE_SCENE_LAYERS; i++) {
    const canvas = document.createElement('canvas');
    canvas.className = 'mode-scene-layer';
    canvas.style.animationDelay = `${-(i * (MODE_SCENE_ANIM_SEC / MODE_SCENE_LAYERS))}s`;
    canvas.width = SCENE_W * dpr;
    canvas.height = SCENE_H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    variants[i % variants.length](ctx);
    container.appendChild(canvas);
  }
}

function stopModeTipRotation() {
  if (modeTipTimer) { clearInterval(modeTipTimer); modeTipTimer = null; }
}

// Restarted every time the active page changes (see goToModePage) so each
// page always starts on its own first tip rather than wherever the
// previous page's rotation happened to leave off.
function startModeTipRotation(idx) {
  stopModeTipRotation();
  modeTipIdx = 0;
  const pageEl = document.querySelectorAll('.mode-page')[idx];
  const tipEl = pageEl && pageEl.querySelector('.mode-tip');
  const tips = MODE_PAGES[idx] && MODE_PAGES[idx].tips;
  if (!tipEl || !tips || !tips.length) return;
  tipEl.textContent = tips[0];
  modeTipTimer = setInterval(() => {
    tipEl.classList.add('fading');
    setTimeout(() => {
      modeTipIdx = (modeTipIdx + 1) % tips.length;
      tipEl.textContent = tips[modeTipIdx];
      tipEl.classList.remove('fading');
    }, 300); // matches .mode-tip's CSS opacity transition duration
  }, 4500);
}

function renderModeDots() {
  const dotsEl = document.getElementById('mode-browser-dots');
  dotsEl.innerHTML = '';
  MODE_PAGES.forEach((mode, i) => {
    const dot = document.createElement('button');
    dot.className = 'mode-dot';
    dot.setAttribute('aria-label', mode.key);
    dot.onclick = () => goToModePage(i);
    dotsEl.appendChild(dot);
  });
}

function goToModePage(idx) {
  modeBrowserIdx = clamp(idx, 0, MODE_PAGES.length - 1);
  const track = document.getElementById('mode-browser-track');
  track.style.transform = `translateX(-${modeBrowserIdx * 100}vw)`;
  document.querySelectorAll('.mode-dot').forEach((dot, i) => dot.classList.toggle('active', i === modeBrowserIdx));
  // Hide whichever arrow points somewhere you can't go - there's nothing
  // past the first/last page to browse toward.
  document.getElementById('mode-browser-prev').classList.toggle('hidden', modeBrowserIdx === 0);
  document.getElementById('mode-browser-next').classList.toggle('hidden', modeBrowserIdx === MODE_PAGES.length - 1);
  startModeTipRotation(modeBrowserIdx);
}

// idx defaults to whichever page is currently showing - the Enter/Space
// keyboard shortcut and each page's own Play button both just want "this one".
function selectModePage(idx) {
  const mode = MODE_PAGES[idx != null ? idx : modeBrowserIdx];
  if (!mode) return;
  SFX.warmup();
  if (mode.onSelect) mode.onSelect();
  else showScreen(mode.screen);
}

// Drag-to-swipe, mouse or touch - pointermove/pointerup are only attached to
// the window while an actual drag is in progress (removed again on release),
// so this stays cheap and doesn't need pointer capture on an element that
// also contains real clickable buttons (each page's Play button).
function bindModeBrowserSwipe() {
  const track = document.getElementById('mode-browser-track');
  const SWIPE_THRESHOLD = 60;
  let startX = null, startY = null, dragging = false, decided = false, horizontal = false;

  const onMove = (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (!decided) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      decided = true;
      horizontal = Math.abs(dx) > Math.abs(dy);
      if (horizontal) track.style.transition = 'none';
    }
    if (!horizontal) return;
    e.preventDefault();
    track.style.transform = `translateX(${-modeBrowserIdx * window.innerWidth + dx}px)`;
  };
  const onUp = (e) => {
    if (!dragging) return;
    dragging = false;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    track.style.transition = '';
    if (horizontal) {
      const dx = e.clientX - startX;
      if (dx < -SWIPE_THRESHOLD) goToModePage(modeBrowserIdx + 1);
      else if (dx > SWIPE_THRESHOLD) goToModePage(modeBrowserIdx - 1);
      else goToModePage(modeBrowserIdx); // too small a drag - snap back
    }
  };
  track.addEventListener('pointerdown', (e) => {
    startX = e.clientX; startY = e.clientY;
    dragging = true; decided = false; horizontal = false;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
}

function initModeBrowser() {
  renderModeDots();
  document.querySelectorAll('.mode-page').forEach((pageEl, i) => {
    renderModeAbstractLines(pageEl.querySelector('.mode-abstract-bg'));
    renderModeCollage(pageEl.querySelector('.mode-collage'));
    renderModeSceneLayers(pageEl.querySelector('.mode-scene-bg'), pageEl.dataset.mode);
    const enterBtn = pageEl.querySelector('.mode-enter-btn');
    if (enterBtn) enterBtn.onclick = () => selectModePage(i);
  });
  document.getElementById('mode-browser-prev').onclick = () => goToModePage(modeBrowserIdx - 1);
  document.getElementById('mode-browser-next').onclick = () => goToModePage(modeBrowserIdx + 1);
  bindModeBrowserSwipe();
  goToModePage(0);
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
// Human-readable name for fixture.round (0-based) per competition - used by
// applyCareerFixtureResult/resolveEuropeGroup to record WHERE a knocked-out
// competition ended (see CAREER.seasonEliminations), not just that it did,
// for the end-of-season summary (showSeasonCompleteOverlay).
const FA_CUP_ROUND_NAMES = ['Round of 16', 'Quarter-Final', 'Semi-Final', 'Final']; // matches FA_CUP_ROUNDS, same shape as standalone Cup mode's CUP_ROUND_NAMES
const LEAGUE_CUP_ROUND_NAMES = ['Quarter-Final', 'Semi-Final', 'Final']; // matches LEAGUE_CUP_ROUNDS
function careerRoundName(fixtureType, roundIndex) {
  if (fixtureType === 'facup') return FA_CUP_ROUND_NAMES[roundIndex] || `Round ${roundIndex + 1}`;
  if (fixtureType === 'leaguecup') return LEAGUE_CUP_ROUND_NAMES[roundIndex] || `Round ${roundIndex + 1}`;
  if (fixtureType.endsWith('-knockout')) {
    // Mirrors resolveEuropeGroup's own knockoutRounds array - UCL runs a
    // Semi-Final before its Final, UEL goes straight to one.
    const names = fixtureType.startsWith('ucl') ? ['Semi-Final', 'Final'] : ['Final'];
    return names[roundIndex] || `Round ${roundIndex + 1}`;
  }
  return null;
}
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

// The rest of your division's table, starting at 0 for a fresh season -
// filled in live, round by round, as your own league fixtures resolve (see
// advanceLeagueRound), rather than guessed once upfront. Every other club's
// row only ever has an actual result applied to it (either the mirror of
// your own real/simmed result, for whoever you played that round, or a
// quick simulateFixture result for everyone else that round) - so the table
// stays an honest running record instead of a single re-rolled guess.
// league is passed explicitly (not read off CAREER.clubLeague) so Season
// mode can reuse this same table-tracking system for its own league too -
// see startSeason.
function generateLeagueTableEstimate(clubIdx, league) {
  const leagueClubs = ALL_CLUBS.map((c, i) => i).filter(i => ALL_CLUBS[i].league === league);
  return leagueClubs.filter(i => i !== clubIdx).map(i => ({ clubIdx: i, points: 0, gd: 0, gf: 0, ga: 0 }));
}

// Called once per league fixture you resolve (played live or simmed - both
// funnel through applyCareerFixtureResult) to advance the WHOLE division by
// one round: your opponent this round gets the mirror of your own actual
// result applied directly (not a separately-simulated number for the same
// match), and every other club still in the table plays a quick simulated
// match against another of their number this round, so the table keeps
// moving in step with your own season instead of sitting frozen.
// tableEstimate is passed explicitly (not read off CAREER.tableEstimate) so
// Season mode's own standings can advance through this same function too.
function advanceLeagueRound(tableEstimate, oppIdx, yourGf, yourGa) {
  const oppRow = tableEstimate.find(r => r.clubIdx === oppIdx);
  if (oppRow) {
    if (yourGf > yourGa) { /* you won this fixture - your opponent gets nothing */ }
    else if (yourGf === yourGa) oppRow.points += 1;
    else oppRow.points += 3;
    oppRow.gd += yourGa - yourGf;
    oppRow.gf = (oppRow.gf || 0) + yourGa;
    oppRow.ga = (oppRow.ga || 0) + yourGf;
  }
  const others = shuffled(tableEstimate.filter(r => r.clubIdx !== oppIdx));
  for (let i = 0; i + 1 < others.length; i += 2) {
    const a = others[i], b = others[i + 1];
    const sim = simulateFixture(effectiveClub(a.clubIdx).strength || 1, effectiveClub(b.clubIdx).strength || 1);
    if (sim.home > sim.away) a.points += 3;
    else if (sim.home === sim.away) { a.points += 1; b.points += 1; }
    else b.points += 3;
    a.gd += sim.home - sim.away;
    b.gd += sim.away - sim.home;
    a.gf = (a.gf || 0) + sim.home; a.ga = (a.ga || 0) + sim.away;
    b.gf = (b.gf || 0) + sim.away; b.ga = (b.ga || 0) + sim.home;
  }
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
    // The flip side of seasonTrophies - null until (if) that competition
    // ends in defeat, then the round name it happened at (see
    // careerRoundName). Never entering a competition at all (no European
    // qualification this season, say) just leaves it null too - the season
    // summary only shows a competition you actually played a fixture in.
    seasonEliminations: { facup: null, leaguecup: null, ucl: null, uel: null },
    seasonHistory: [],
  };
  // buildCareerFixtures/generateLeagueTableEstimate read CAREER.clubLeague off
  // the global - CAREER has to already be assigned before calling them, not
  // evaluated inline as part of constructing this same object literal (that
  // would read the *old* CAREER, null on a brand new save).
  CAREER.fixtures = buildCareerFixtures(clubIdx);
  CAREER.tableEstimate = generateLeagueTableEstimate(clubIdx, def.league);
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
      p.age = cp.age; // real persistent age, not makeSquadPlayer's random placeholder roll
      p.careerId = cp.id; // lets a goal scored this match be credited back to the persistent player - see recordCareerResult
      // Playing their real position gets full attributes; a neighbouring
      // line (see GROUP_ADJACENT/canPlayGroup, checked back when they were
      // put in this slot) gets a mild across-the-board penalty instead of
      // outright refusing the selection.
      const outOfPos = cp.group !== slot.group ? OUT_OF_POSITION_PENALTY : 1;
      p.pace = cp.pace * outOfPos; p.tackling = cp.tackling * outOfPos;
      p.finishing = cp.finishing * outOfPos; p.reflexes = cp.reflexes * outOfPos;
      p.passing = (cp.passing != null ? cp.passing : cp.finishing) * outOfPos;
      p.dribbling = (cp.dribbling != null ? cp.dribbling : cp.pace) * outOfPos;
      p.strength = (cp.strength != null ? cp.strength : cp.tackling) * outOfPos;
      // Fitness isn't positional, so out-of-position play doesn't dent it.
      p.staminaRating = cp.staminaRating != null ? cp.staminaRating : 1;
    }
  });
  // Bench - not formation-locked (real benches aren't either), just the rest
  // of the squad, labelled with their own natural position.
  const pool = shuffled(reserves);
  team.bench.forEach((p, i) => {
    const cp = pool[i];
    if (!cp) return;
    p.realName = cp.name;
    p.age = cp.age; // real persistent age, not makeSquadPlayer's random placeholder roll
    p.careerId = cp.id;
    p.group = cp.group;
    p.isGK = cp.group === 'GK';
    p.pace = cp.pace; p.tackling = cp.tackling; p.finishing = cp.finishing; p.reflexes = cp.reflexes;
    p.passing = cp.passing != null ? cp.passing : cp.finishing;
    p.dribbling = cp.dribbling != null ? cp.dribbling : cp.pace;
    p.strength = cp.strength != null ? cp.strength : cp.tackling;
    p.staminaRating = cp.staminaRating != null ? cp.staminaRating : 1;
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
  CAREER.seasonEliminations = CAREER.seasonEliminations || { facup: null, leaguecup: null, ucl: null, uel: null };
  if (fixture.type === 'league') {
    const r = CAREER.record;
    r.played++; r.gf += gf; r.ga += ga;
    if (gf > ga) { r.won++; r.points += 3; }
    else if (gf === ga) { r.drawn++; r.points += 1; }
    else { r.lost++; }
    CAREER.results.push({ oppIdx: fixture.oppIdx, gf, ga });
    pushCareerMatchLog(fixture, gf, ga);
    advanceLeagueRound(CAREER.tableEstimate, fixture.oppIdx, gf, ga);
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
      CAREER.seasonEliminations[comp] = careerRoundName(fixture.type, fixture.round);
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
    CAREER.seasonEliminations[fixture.type] = careerRoundName(fixture.type, fixture.round);
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
    CAREER.seasonEliminations = CAREER.seasonEliminations || { facup: null, leaguecup: null, ucl: null, uel: null };
    CAREER.seasonEliminations[comp] = 'Group Stage';
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
  return CAREER.squad.reduce((sum, cp) => sum + positionNeutralAvg(cp), 0) / CAREER.squad.length;
}
function careerSimNextFixture() {
  const fixture = CAREER.fixtures[CAREER.fixtureIdx];
  const oppIdx = fixture.oppIdx;
  const result = simulateFixture(careerSquadStrength(), effectiveClub(oppIdx).strength || 1);
  applyCareerFixtureResult(fixture, result.home, result.away);
  CAREER.fixtureIdx++;
  // Result itself shows via the always-visible career-last-result box (see
  // renderCareerDashboard), not a toast - a queued 1.6s-per-toast notification
  // can't keep up with mashing Sim through a stack of fixtures.
  if (CAREER.fixtureIdx >= CAREER.fixtures.length) endCareerSeason();
  saveCareerSlot(CAREER.slot, CAREER);
}

// Aging/progression/generation cycle - fires once the fixture list runs out,
// whether the last fixture was played live or simmed.
function endCareerSeason() {
  // Wages come out of the budget as a lump sum for the season just played
  // (not tracked matchday-by-matchday - there's no in-season cashflow model
  // here, just an annual settling-up) - summed BEFORE the retire/expire
  // filter below drops anyone, so a player who leaves this same off-season
  // still cost their wage for the season they were actually on the books.
  const wageBill = Math.round(CAREER.squad.reduce((sum, cp) => sum + (cp.wage || 0), 0));
  CAREER.budget -= wageBill;
  const expired = [];
  CAREER.squad = CAREER.squad.filter(cp => {
    cp.age++;
    if (cp.age >= 36) return false; // retires - drops out of the squad entirely
    const avg = (cp.pace + cp.tackling + cp.finishing + cp.reflexes) / 4;
    let delta;
    if (avg < cp.potential - 0.02) delta = rand(0.01, 0.04); // still room to grow toward potential
    else if (cp.age <= 29) delta = rand(-0.01, 0.01); // prime years - roughly stable
    else delta = -rand(0.01, cp.age >= 33 ? 0.05 : 0.03); // decline, faster past 33
    ['pace', 'tackling', 'finishing', 'reflexes', 'passing', 'dribbling', 'strength'].forEach(attr => {
      cp[attr] = clamp((cp[attr] != null ? cp[attr] : avg) + delta + rand(-0.02, 0.02), 0.4, 1.5);
    });
    cp.value = computePlayerValue(cp);
    cp.wage = computePlayerWage(cp);
    // Contract countdown - reaching 0 means it's actually run out (not just
    // "about to"), so they leave as a free transfer at that point rather
    // than one season earlier. Renewing (see startRenewNegotiation, offered
    // in the squad screen once low) resets this before it can hit 0.
    cp.contractYears = (cp.contractYears == null ? 3 : cp.contractYears) - 1;
    if (cp.contractYears <= 0) { expired.push(cp.name); return false; }
    return true;
  });
  if (expired.length) {
    showToast(`📋 Contract${expired.length > 1 ? 's' : ''} expired: ${expired.join(', ')}`, '#eab308');
  }
  if (CAREER.seasonNumber >= CAREER.nextGenerationSeason) {
    CAREER.freeAgents.push(...generateRegenBatch());
    CAREER.nextGenerationSeason = CAREER.seasonNumber + 1 + Math.floor(rand(3, 5));
  }
  // The rest of the football world moves on too - every club's strength
  // drifts a little and its squad gradually refreshes, see evolveWorldClub -
  // plus a real transfer window's worth of AI-to-AI moves between OTHER
  // clubs, see simulateWorldTransfers.
  ALL_CLUBS.forEach((c, i) => evolveWorldClub(i));
  simulateWorldTransfers();
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
  CAREER.seasonEliminations = CAREER.seasonEliminations || { facup: null, leaguecup: null, ucl: null, uel: null };
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
    eliminations: { ...CAREER.seasonEliminations },
  };
  CAREER.seasonHistory.push(seasonSummary);
  CAREER.lastSeasonSummary = seasonSummary;
  CAREER.seasonTrophies = { facup: false, leaguecup: false, ucl: false, uel: false };
  CAREER.seasonEliminations = { facup: null, leaguecup: null, ucl: null, uel: null };
  CAREER.budget += 15 + CAREER.record.points; // simple prize-money-ish top-up
  CAREER.seasonNumber++;
  CAREER.fixtures = buildCareerFixtures(CAREER.clubIdx);
  CAREER.fixtureIdx = 0;
  CAREER.record = { played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0 };
  CAREER.results = [];
  CAREER.tableEstimate = generateLeagueTableEstimate(CAREER.clubIdx, CAREER.clubLeague);
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
          const factor = isYoung ? (club.strength || 1.05) * 0.8 : (club.strength || 1.05) * resolveRenownFactor(name, gi, names.length);
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

// Your growing standing in the game's world - a real big club's players
// don't move to a nobody, but they will once that "nobody" has actually
// proven itself (won things, established itself in a strong league). Starts
// at your own club's base strength and climbs with silverware, so a
// newly-created save can't immediately raid the champions but a few good
// seasons opens that door.
function careerReputation() {
  const base = effectiveClub(CAREER.clubIdx).strength || 1;
  const silverware = CAREER.leagueTitlesWon * 0.04 + CAREER.uclTitlesWon * 0.08 + CAREER.uelTitlesWon * 0.04
    + CAREER.faCupsWon * 0.02 + CAREER.leagueCupsWon * 0.015;
  return base + silverware;
}
// How far above your own reputation a selling club's strength can sit
// before they simply won't do business with you - a real big club selling
// to a real minnow just doesn't happen, but it's a soft gap (not "never"),
// so a strong-but-not-title-winning side can still pick off a squad player
// from a considerably bigger club, just not their best players from the
// very elite.
const BUY_REPUTATION_GAP = 0.22;

// `terms` (optional) carries whatever was actually agreed at the negotiating
// table - see startSignNegotiation - rather than always just paying full
// asking price on a flat 3-5 year deal. Omit it entirely for the old
// behaviour (full value, random contract length), still used as a fallback
// nowhere currently calls it that way, but keeps this safe to call directly.
function signPlayer(cp, terms) {
  const fee = terms && terms.fee != null ? terms.fee : cp.value;
  const wage = terms && terms.wage != null ? terms.wage : cp.wage;
  const contractYears = terms && terms.contractYears != null ? terms.contractYears : Math.floor(rand(3, 6));
  if (CAREER.squad.some(p => p.id === cp.id)) return false; // already signed - guards a stale button reference from a pre-reflow render
  if (cp.clubIdx != null) {
    const sellerStrength = effectiveClub(cp.clubIdx).strength || 1;
    if (sellerStrength - careerReputation() > BUY_REPUTATION_GAP) return 'reputation';
  }
  if (CAREER.budget < fee) return 'budget';
  CAREER.budget -= fee;
  cp.wage = wage;
  cp.contractYears = contractYears; // a brand new deal at your club, not whatever was left on their old one
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

function initMatch(yourIdx, oppIdx, halfLenMin, skillKey) {
  lastMatchSettings = { yourIdx, oppIdx, halfLenMin, skillKey };
  initMatchWithClubs(ALL_CLUBS[yourIdx], ALL_CLUBS[oppIdx], halfLenMin, skillKey);
}

// Same as initMatch, but takes full club objects instead of ALL_CLUBS
// indices - Career mode already only ever deals in club objects, never a
// plain index, since a save's club can drift (see effectiveClub). initMatch
// itself is just a thin index-based wrapper around this for Play/Season/Cup.
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
  G.momentum = [0, 0]; // see updateMomentum/momentumMultiplier - a short-lived edge for whoever just scored
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
  homePanel.style.setProperty('--panel-badge', readableTextColor(homeDef.shirt));
  awayPanel.style.setProperty('--panel-color', oppKit.shirt);
  awayPanel.style.setProperty('--panel-text', readableTextColor(oppKit.shirt));
  awayPanel.style.setProperty('--panel-badge', readableTextColor(oppKit.shirt));
  setTeamCrest('crest-home', homeDef);
  // oppKit may just be oppDef's own away kit sub-object (no .name of its
  // own) - name always comes from the real club, colour from whichever kit
  // is actually being worn (see the kitsClash check above).
  setTeamCrest('crest-away', { name: oppDef.name, shirt: oppKit.shirt });
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

// Within this many metres of the ball, a defender presses regardless of
// their team's usual pressCount - see updatePressing. "Under pressure"
// shouldn't be something even a low-press team's defenders just shrug off
// because they weren't one of the nominal top-N closest.
const FORCED_PRESS_RADIUS = 7;

function defendTarget(p, team) {
  const drop = (p.group === 'FWD' ? 6 : p.group === 'MID' ? 3 : 1) * (PRESS_STYLES[team.pressStyle] || PRESS_STYLES.mid).dropMult;
  const tx = p.home.x - drop * team.attackDir;
  // A real back line doesn't just track the ball's y like a camera - it
  // shifts to cover whatever's actually dangerous, which is often an
  // opponent making a run rather than the ball itself. Blend home position,
  // ball position, and the average position of nearby opposing outfield
  // players ahead of this defender (the "threats") rather than picking one.
  const oppTeam = G.teams[1 - p.__team];
  const aheadX = p.home.x + 15 * team.attackDir;
  const threats = outfield(oppTeam).filter(o => team.attackDir === 1 ? o.pos.x < aheadX : o.pos.x > aheadX);
  const threatY = threats.length ? threats.reduce((sum, o) => sum + o.pos.y, 0) / threats.length : G.ball.pos.y;
  const coverY = lerp(G.ball.pos.y, threatY, 0.4);
  const ty = lerp(p.home.y, coverY, 0.3);
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
    // Anyone else close enough presses too, however many that turns out to
    // be - a low-press team's 3rd/4th-nearest defender standing off inside
    // FORCED_PRESS_RADIUS while only the nominal top-1 or 2 actually engage
    // is exactly the gap a human dribbler could walk straight through.
    candidates.forEach(p2 => { if (dist(p2.pos, G.ball.pos) < FORCED_PRESS_RADIUS) p2.pressing = true; });
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
  if (!p.isGK) speed *= finalThirdMultiplier(team, 'pace') * momentumMultiplier(team, 'pace');
  // Team strength and difficulty can push pace well above the old fixed
  // range this was tuned against - re-cap normal movement below your own
  // speed so a strong/boosted opponent still can't simply outrun you.
  // A deliberate breakaway run is allowed past that cap - that's the point.
  // A player actively pressing gets a slightly HIGHER cap instead - just
  // enough to actually close down and catch a dribbling human rather than
  // trailing at a fixed distance forever, which used to let you stroll
  // straight past a "pressing" defender that could never quite catch up.
  if (!p.isGK) speed = Math.min(speed, HUMAN_SPEED * (p.pressing ? 1.04 : 0.97));
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
  if (Math.random() < clamp(G.skill.tackleChance * p.tackling * finalThirdMultiplier(G.teams[p.__team], 'tackle') * momentumMultiplier(G.teams[p.__team], 'tackle') / carrierResistance(G.ball.owner), 0.05, 0.95)) {
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

// `aim` (-1..1) is only passed for a human-steered throw-in (see
// isAimableThrowinSituation) - every other pass (AI takers, open play,
// any other restart) keeps the existing nearest-teammate-in-cone targeting
// by leaving it undefined.
function releasePass(player, team, power, aim) {
  SFX.kick();
  const restartKindAtKick = G.restart ? G.restart.kind : null;
  const offsideExempt = OFFSIDE_EXEMPT_KINDS.includes(restartKindAtKick);
  if (G.restart && G.ball.owner === player) G.restart = null;
  const teammates = team.players.filter(p => p !== player);
  const facing = len(player.facing) > 0.01 ? norm(player.facing) : { x: team.attackDir, y: 0 };

  let target, straightDir;
  if (aim != null && restartKindAtKick === 'throwin' && teammates.length) {
    // Steered throw-in - aim sweeps from thrown back toward your own goal
    // (-1) to thrown forward toward the opponent's (+1), always angled INTO
    // the pitch from whichever touchline the throw is taken from (a real
    // throw can't land anywhere else) - see THROWIN_AIM_ANGLE. The actual
    // receiver is just whichever teammate ends up most closely along that
    // thrown line, so control-follow/offside etc still have a real target.
    const intoField = player.pos.y < PITCH_WID / 2 ? 1 : -1;
    straightDir = rotateVec({ x: 0, y: intoField }, clamp(aim, -1, 1) * THROWIN_AIM_ANGLE * team.attackDir);
    const alignCost = (v) => 1 - (straightDir.x * v.x + straightDir.y * v.y); // smaller = more aligned with the thrown direction
    target = teammates.slice().sort((a, b) => alignCost(norm(sub(a.pos, player.pos))) - alignCost(norm(sub(b.pos, player.pos))))[0];
  } else {
    let cone = teammates.filter(t => {
      const d = norm(sub(t.pos, player.pos));
      return (d.x * facing.x + d.y * facing.y) > 0.26;
    });
    if (cone.length === 0) cone = teammates;
    cone.sort((a, b) => dist(a.pos, player.pos) - dist(b.pos, player.pos));
    target = cone[0];
    straightDir = norm(sub(target.pos, player.pos));
  }
  if (checkOffsideAndCall(target, team, offsideExempt)) return;
  const passDist = dist(target.pos, player.pos);
  // Passing is a real attribute, not just a display stat - a weak passer's
  // ball drifts off the intended line; an elite one is pinpoint. ~0deg of
  // wobble at the top end (passing >= 1.2) up to ~23deg for the weakest. A
  // wet pitch (see RAIN_WOBBLE_BONUS) adds a flat bit of extra wobble on
  // top for everyone - even the best passers lose a touch of precision on a
  // slick ball, though a great passer still ends up far more reliable than
  // a poor one.
  let wobbleAngle = clamp((1.2 - (player.passing != null ? player.passing : 1)) * 0.35, 0, 0.4) + (G.weather === 'rain' ? RAIN_WOBBLE_BONUS : 0);
  // Assisted: wobble is suppressed almost to nothing once the receiver is
  // close to a touchline/goal line, where even a small stray angle would
  // send the ball straight out of play - full skill-based wobble still
  // applies to anyone standing centrally, so Passing still matters there.
  const edgeDist = Math.min(target.pos.y, PITCH_WID - target.pos.y, target.pos.x, PITCH_LEN - target.pos.x);
  wobbleAngle *= clamp(edgeDist / PASS_EDGE_ASSIST_MARGIN, 0.15, 1);
  const dir = wobbleAngle > 0.001 ? rotateVec(straightDir, rand(-wobbleAngle, wobbleAngle)) : straightDir;
  // A bare tap (power ~0) still carries enough pace to actually reach the
  // receiver with real speed instead of dying short/soft and needing them
  // to run the last bit themselves - distanceAssistSpeed is exactly the
  // speed needed to arrive at PASS_MIN_ARRIVAL_SPEED given how fast the
  // ball decelerates (PITCH_FRICTION). Holding for extra power still adds
  // pace on top of whatever the distance alone demands, for a firmer,
  // faster ball - capped at PASS_MAX_SPEED so a long tap's assist can never
  // actually outrun what a real full-power charge would produce.
  const chargedSpeed = PASS_MIN_SPEED + power * (PASS_MAX_SPEED - PASS_MIN_SPEED);
  const distanceAssistSpeed = Math.sqrt(PASS_MIN_ARRIVAL_SPEED * PASS_MIN_ARRIVAL_SPEED + 2 * PITCH_FRICTION * passDist);
  const speed = clamp(Math.max(chargedSpeed, distanceAssistSpeed), PASS_MIN_SPEED, PASS_MAX_SPEED);

  G.ball.owner = null;
  G.ball.pos = { x: player.pos.x + facing.x * 0.4, y: player.pos.y + facing.y * 0.4 };
  G.ball.vel = { x: dir.x * speed, y: dir.y * speed };
  G.ball.lastTouchTeam = player.__team;
  G.ball.lastToucher = player;
  G.ball.kickImmuneFrom = player;
  G.ball.kickImmuneUntil = performance.now() / 1000 + 0.5;
  G.ball.shotOrigin = null; // a pass isn't a shot attempt - don't let a stale shot's range difficulty leak into an accidental goal-mouth deflection
  // Whoever this was aimed at gets a bigger reception radius in checkPickup
  // (see PASS_RECEPTION_RADIUS) - self-expires shortly after, so it can't
  // linger and give some unrelated later loose ball an unfair magnet.
  G.ball.passTarget = target;
  G.ball.passTargetUntil = performance.now() / 1000 + 4;
  // Control deliberately does NOT jump to the receiver here - it switches
  // naturally once they actually get the ball (checkPickup sets
  // G.ball.owner and calls autoAssignControl), same as any other pickup.
  // Switching instantly on the kick meant the human took over the receiver
  // before the ball arrived, and since aiMovePlayer skips human-controlled
  // players, nothing was left steering them into the ball's path - they'd
  // just stand still while a fast pass sailed past instead of drifting
  // there under normal AI positioning like they do right up until the catch.
}

// `aim` is either:
// - an object { x, y } - a free-aimed world-space direction from the Shoot
//   joystick (see bindShootJoystick), used for open-play shots aimed at any
//   angle, not just a spot along the goal line - power auto-assists toward
//   whatever's needed from this range, see the distToGoal block below.
// - a number -1..1 (left post to right post) - a human-steered dead ball
//   (penalty/free kick/corner - see isAimableShotSituation).
// - null/undefined - every other shot (AI takers, an un-aimed open-play tap)
//   keeps the existing random-but-skill-weighted auto-targeting.
function releaseShot(player, team, power, aim) {
  SFX.kick();
  if (power > 0.7) shakeScreen(); // a real thump of a strike
  const goalX = team.attackDir === 1 ? PITCH_LEN : 0;
  const goalY = PITCH_WID / 2;

  let aimPoint;
  if (aim && typeof aim === 'object') {
    // The direction IS the shot (not a spot picked along the goal line),
    // so this reads correctly from any angle rather than only face-on.
    // Finishing still adds a little real wobble on top - even a deliberate
    // aim isn't a laser regardless of skill.
    const accuracy = clamp(player.finishing, 0.6, 1.5);
    const wobbleAngle = clamp((1.3 - accuracy) * 0.25, 0, 0.3);
    const dir0 = rotateVec(norm(aim), rand(-wobbleAngle, wobbleAngle));
    const reach = PITCH_LEN * 1.3; // comfortably past any real target, so the projected point is always well beyond the goal
    aimPoint = { x: player.pos.x + dir0.x * reach, y: player.pos.y + dir0.y * reach };
    G.stats.shots[player.__team]++;
    const tGoal = dir0.x !== 0 ? (goalX - player.pos.x) / dir0.x : Infinity;
    const crossY = player.pos.y + dir0.y * tGoal;
    if (tGoal > 0 && Math.abs(crossY - goalY) <= GOAL_WIDTH / 2) G.stats.shotsOnTarget[player.__team]++;
    // A joystick flick from distance shouldn't also require holding for a
    // full power charge just to reach goal - power auto-assists toward
    // whatever's actually needed to trouble the keeper from this range,
    // same idea as releasePass's distance assist. Holding longer still
    // adds more on top for a real thump.
    const distToGoal = dist(player.pos, { x: goalX, y: goalY });
    const autoPower = clamp(0.35 + distToGoal / (G.skill.shootRange * 1.6), 0.35, 1);
    power = Math.max(power, autoPower);
  } else if (aim != null) {
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
  G.ball.shotOrigin = { x: player.pos.x, y: player.pos.y };
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
    const decel = PITCH_FRICTION * (G.weather === 'rain' ? RAIN_FRICTION_MULT : 1) * dt;
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
  const isPassTarget = b.passTarget && now < b.passTargetUntil;
  let best = null, bestD = Infinity;
  for (const team of G.teams) {
    for (const p of team.players) {
      if (p.sentOff) continue;
      if (p === b.kickImmuneFrom && now < b.kickImmuneUntil) continue;
      const radius = (isPassTarget && p === b.passTarget) ? PASS_RECEPTION_RADIUS : PICKUP_RADIUS;
      const d = dist(p.pos, b.pos);
      if (d < radius && d < bestD) { bestD = d; best = p; }
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
  if (now - (gk.lastSmotherTry || 0) < GK_SMOTHER_RETRY_SEC) return false;
  gk.lastSmotherTry = now;
  // Diving, not Reflexes - smothering the ball at an onrushing attacker's
  // feet is a reach/dive action, distinct from reacting to a struck shot
  // (see resolveGoalAttempt below).
  if (Math.random() >= clamp(GK_SMOTHER_CHANCE * gkDiving(gk), 0.05, 0.95)) return false;
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

// How hard a shot is to convert, purely as a function of range - a real
// finish is easiest from around the six-yard line out to just past the
// penalty spot; any closer in gets harder again (a shot right on the goal
// line has almost no angle to work with), and it gets steadily harder the
// further out beyond the box. Returned as a multiplier on GK_SAVE_CHANCE
// (>1 = harder to score, <1 = easier).
function shotDistanceFactor(d) {
  if (d <= SIX_YARD_DEPTH) return lerp(1.5, 0.85, d / SIX_YARD_DEPTH);
  const sweetSpotEnd = SIX_YARD_DEPTH + 6; // six-yard box "and a bit further"
  if (d <= sweetSpotEnd) return lerp(0.85, 0.7, (d - SIX_YARD_DEPTH) / (sweetSpotEnd - SIX_YARD_DEPTH));
  if (d <= BOX_DEPTH) return lerp(0.7, 1.0, (d - sweetSpotEnd) / (BOX_DEPTH - sweetSpotEnd));
  return clamp(1.0 + (d - BOX_DEPTH) * 0.035, 1.0, 2.2);
}

function resolveGoalAttempt(endDir) {
  const defender = defendingTeamAtGoalEnd(endDir);
  const attacker = attackingTeamAtGoalEnd(endDir);
  const gk = defender.players.find(p => p.isGK);
  const b = G.ball;
  const goalPos = { x: endDir === 1 ? PITCH_LEN : 0, y: PITCH_WID / 2 };
  const rawDistFactor = b.shotOrigin ? shotDistanceFactor(dist(b.shotOrigin, goalPos)) : 1;
  b.shotOrigin = null;
  // Positioning - good angle-reading/anticipation takes some of the sting
  // out of a genuinely awkward shot (tight angle, distance) rather than
  // just being another flat multiplier alongside Reflexes - a well-
  // positioned keeper is less punished by a hard chance, not just quicker
  // to react to an easy one.
  const posMitigation = lerp(1, 0.8, clamp((gkPositioning(gk) - 0.6) / 0.9, 0, 1));
  const distFactor = 1 + (rawDistFactor - 1) * posMitigation;
  const saved = Math.random() < clamp(GK_SAVE_CHANCE * gk.reflexes * distFactor, 0.05, 0.95);
  if (saved) {
    SFX.catch();
    b.pos = { x: gk.pos.x, y: gk.pos.y };
    // Handling - a poor-handling keeper doesn't always hold a save cleanly;
    // it can spill loose right back into the six-yard box for a scramble
    // instead of an automatic dead ball, same as a real parried save.
    const heldCleanly = Math.random() < clamp(gkHandling(gk), 0.2, 0.97);
    if (heldCleanly) {
      G.ball.owner = gk;
      G.ball.vel = { x: 0, y: 0 };
      G.ball.lastTouchTeam = gk.__team;
      autoAssignControl();
    } else {
      loseBallFrom(gk, gk.__team);
      autoAssignControl();
      const teamName = document.getElementById(gk.__team === 0 ? 'score-home-name' : 'score-away-name').textContent;
      showToast('🧤 Save spilled - loose ball!', '#f97316');
      logMatchEvent(`🧤 ${teamName} - ${playerLabel(gk)} can't hold on to it`);
    }
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
// The last REPLAY_WINDOW_MS of *real* build-up - played back at half-speed
// (see stepGoalReplay), so this is roughly a 6s clip, long enough to
// actually show the shot/goal itself rather than cutting off right as it
// happens. Trimmed by wall-clock time rather than a fixed frame count -
// recordReplayFrame runs once per rendered frame (see loop()), and frame
// rate varies by device (a 120Hz phone records twice as many frames per
// second as a 60Hz one), so a frame-count cutoff would silently buffer a
// different amount of real time depending on hardware. Timestamping each
// frame and trimming by age keeps this genuinely "last 3 seconds" everywhere.
const REPLAY_WINDOW_MS = 3000;
// Skip showing a clip at all if there isn't at least this much real history
// buffered yet (e.g. a goal seconds after kickoff) - caller runs onDone
// itself immediately in that case, same as before.
const REPLAY_MIN_BUILDUP_MS = 1000;
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
  const now = performance.now();
  G.replayBuffer.push({ t: now, snap: snapshotPositions() });
  while (G.replayBuffer.length > 1 && now - G.replayBuffer[0].t > REPLAY_WINDOW_MS) G.replayBuffer.shift();
}
// Returns true if a clip actually started (onDone will be called once it
// finishes); false if there wasn't enough build-up recorded to bother with
// (e.g. a goal seconds after kickoff) - caller should run onDone itself then.
function startGoalReplay(onDone) {
  if (!G.replayBuffer.length || performance.now() - G.replayBuffer[0].t < REPLAY_MIN_BUILDUP_MS) return false;
  G.replay.restoreState = snapshotPositions();
  G.replay.frames = G.replayBuffer.map(f => f.snap);
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
  if (G.momentum) {
    const concedingIdx = 1 - scoringIdx;
    G.momentum[scoringIdx] = clamp(G.momentum[scoringIdx] + MOMENTUM_GOAL_BOOST, -1, 1);
    G.momentum[concedingIdx] = clamp(G.momentum[concedingIdx] - MOMENTUM_CONCEDE_HIT, -1, 1);
  }
  document.getElementById('score-home').textContent = G.teams[0].score;
  document.getElementById('score-away').textContent = G.teams[1].score;
  const scoredBadge = document.getElementById(scoringIdx === 0 ? 'score-home' : 'score-away');
  scoredBadge.classList.add('score-pop');
  setTimeout(() => scoredBadge.classList.remove('score-pop'), 400);
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
    const homeName = document.getElementById('score-home-name').textContent;
    const awayName = document.getElementById('score-away-name').textContent;
    document.getElementById('goal-banner-score').textContent = `${homeName} ${G.teams[0].score} - ${G.teams[1].score} ${awayName}`;
    setTeamCrest('goal-banner-crest', { name: scoringIdx === 0 ? homeName : awayName, shirt: G.teams[scoringIdx].shirt });
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
  // Same steerable-dead-ball treatment for a throw-in, charged on the PASS
  // button instead of shoot (a throw-in was never shootable) - see
  // isAimableThrowinSituation/releasePass's aim handling.
  if (G.ball.owner === G.controlled && G.charge.pass && isAimableThrowinSituation()) {
    let steer = G.joystick.x;
    if (G.keysDown[KEYS.left]) steer -= 1;
    if (G.keysDown[KEYS.right]) steer += 1;
    G.shotAim = clamp(G.shotAim + steer * dt * 1.2, -1, 1);
    G.controlled.vel = { x: 0, y: 0 };
    return;
  }
  // Locked at the restart spot until you release it - a real penalty/free-kick
  // taker doesn't wander off their run-up either.
  if (G.ball.owner === G.controlled && G.restart) return;
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
    const speed = HUMAN_SPEED * p.pace * pushAmount * lerp(0.7, 1.0, p.stamina) * finalThirdMultiplier(G.teams[0], 'pace') * momentumMultiplier(G.teams[0], 'pace');
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
  if (Math.random() < clamp(HUMAN_TACKLE_CHANCE * G.controlled.tackling * finalThirdMultiplier(G.teams[0], 'tackle') * momentumMultiplier(G.teams[0], 'tackle') / carrierResistance(b.owner), 0.05, 0.95)) {
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
  if (Math.random() < clamp(HUMAN_TACKLE_CHANCE * p.tackling * finalThirdMultiplier(G.teams[1], 'tackle') * momentumMultiplier(G.teams[1], 'tackle') / carrierResistance(b.owner), 0.05, 0.95)) {
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

// A deliberate Shoot-joystick drag always wins (it's the most specific,
// explicit input) - otherwise falls back to the existing 1D dead-ball aim,
// otherwise no aim at all (auto-target/cone-nearest-teammate).
function resolveShootAim(forPlayer) {
  if (G.shootDragMag > SHOOT_DRAG_THRESHOLD) return { x: G.shootAimVec.x, y: G.shootAimVec.y };
  return isAimableShotSituation(forPlayer) ? G.shotAim : undefined;
}

function onChargeRelease(kind) {
  const startKey = kind === 'pass' ? 'passStart' : 'shootStart';
  const held = clamp((performance.now() - G.charge[startKey]) / 1000, 0, 2);
  const power = held / 2;
  G.charge[kind] = false;
  // The guest computes its own power locally (using its own clock/charge
  // timers, same math as above) and, for a steerable dead ball or a
  // joystick-aimed shot, its own aim too (see guestSteerAim/bindShootJoystick)
  // - sending the final numbers directly means the host doesn't need to
  // guess or re-derive anything.
  if (G.online && G.online.role === 'guest') {
    if (G.state !== STATE.PLAYING) return;
    const aim = kind === 'shoot' ? resolveShootAim(G.controlled)
      : (kind === 'pass' && isAimableThrowinSituation(G.controlled)) ? G.shotAim
      : undefined;
    sendOnlineMessage({ type: 'chargeRelease', kind, power, aim });
    return;
  }
  if (G.state !== STATE.PLAYING) return;
  const p = G.controlled;
  if (!p || G.ball.owner !== p) return;
  const restartMustPass = G.restart && G.restart.kind !== 'penalty' && G.restart.kind !== 'freekick' && G.restart.kind !== 'corner';
  if (kind === 'shoot' && restartMustPass) return; // most restarts must be released as a pass; penalties/free kicks/corners can be aimed and shot
  if (kind === 'pass') releasePass(p, G.teams[0], power, isAimableThrowinSituation() ? G.shotAim : undefined);
  else releaseShot(p, G.teams[0], power, resolveShootAim());
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
  const restartMustPass = G.restart && G.restart.kind !== 'penalty' && G.restart.kind !== 'freekick' && G.restart.kind !== 'corner';
  if (kind === 'shoot' && restartMustPass) return;
  if (kind === 'pass') releasePass(p, G.teams[1], power, aim);
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
    const speed = HUMAN_SPEED * p.pace * pushAmount * lerp(0.7, 1.0, p.stamina) * finalThirdMultiplier(G.teams[1], 'pace') * momentumMultiplier(G.teams[1], 'pace');
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
  G.halftimeRemaining = 15;
  document.getElementById('halftime-timer').textContent = G.halftimeRemaining;
  startHalftimeInterval();
  // enterHalftime only ever runs on the host (called from updateClock, which
  // the guest never runs) - tell the guest to show its own halftime overlay.
  if (G.online && G.online.role === 'host') sendOnlineMessage({ type: 'stateChange', state: STATE.HALFTIME });
}

// Split out from enterHalftime so a trip to the Subs page (which shares this
// same 15s-style auto-return pattern) can pause the countdown - stored on
// G.halftimeRemaining rather than a local closure var - and resume it
// afterwards instead of it silently keeping running underneath the subs page.
function startHalftimeInterval() {
  if (G.halftimeInterval) clearInterval(G.halftimeInterval);
  G.halftimeInterval = setInterval(() => {
    G.halftimeRemaining--;
    document.getElementById('halftime-timer').textContent = Math.max(G.halftimeRemaining, 0);
    if (G.halftimeRemaining <= 0) endHalftime();
  }, 1000);
}

// A breather for everyone still on the pitch - not a full reset, fatigue
// still carries into the next period, same idea as a real half-time break.
function recoverStamina(amount) {
  G.teams.forEach(team => team.players.forEach(p => {
    // Bounded by the player's own ceiling too, same as in-play recovery
    // (drainStamina) - a half-time breather still can't undo a lowered
    // ceiling from having run themselves into the ground all half.
    const ceiling = p.staminaCeiling != null ? p.staminaCeiling : 1;
    const before = p.stamina;
    p.stamina = clamp(p.stamina + amount, 0.2, ceiling);
    trackStaminaRecovery(p, p.stamina - before);
  }));
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
    return Object.assign({ goals: 0, wins: 0, matches: 0, cupsWon: 0, uclWon: 0, uelWon: 0, onlineWins: 0, onlineDraws: 0, onlineLosses: 0 }, JSON.parse(localStorage.getItem(LIFETIME_KEY)));
  } catch (e) {
    return { goals: 0, wins: 0, matches: 0, cupsWon: 0, uclWon: 0, uelWon: 0, onlineWins: 0, onlineDraws: 0, onlineLosses: 0 };
  }
}
// myScore/oppScore always from the LOCAL player's own perspective - the
// host and guest are on opposite sides of G.teams[0]/[1] (host is always
// team 0), so each caller passes its own pair in rather than this reading
// G.teams directly.
function recordOnlineResult(myScore, oppScore) {
  const lt = loadLifetime();
  if (myScore > oppScore) lt.onlineWins++;
  else if (myScore === oppScore) lt.onlineDraws++;
  else lt.onlineLosses++;
  saveLifetime(lt);
}
// Shown on the online-menu-screen (see showScreen's id==='online-menu-screen'
// hook) - nothing on this screen carried a record of past online games
// before recordOnlineResult existed.
function renderOnlineHistory() {
  const lt = loadLifetime();
  const played = lt.onlineWins + lt.onlineDraws + lt.onlineLosses;
  const el = document.getElementById('online-history');
  if (!played) { el.innerHTML = ''; return; }
  const tile = (label, value) => `<div class="season-stat-chip"><span class="stat-value">${value}</span><span class="stat-label">${label}</span></div>`;
  el.innerHTML = tile('Wins', lt.onlineWins) + tile('Draws', lt.onlineDraws) + tile('Losses', lt.onlineLosses);
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
  if (CUP && cupNeedsExtraTime()) {
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
  document.getElementById('btn-online-rematch').classList.toggle('hidden', !G.online);
  document.getElementById('btn-online-rematch').disabled = false;
  document.getElementById('online-rematch-status').classList.add('hidden');
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
    if (G.online) recordOnlineResult(G.teams[0].score, G.teams[1].score); // host is always team 0 - see recordOnlineResult
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
  resolvePlayerCollisions();
  updateBall(dt);
  autoAssignControl();
  updateCrowdTension();
  updateMomentum(dt);
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
// Fills the current path (already built by the caller) with plain `shirt`,
// or - if `stripe` is set (a real club with a genuinely striped home kit,
// e.g. Newcastle, Juventus, Athletic Bilbao) - alternating vertical bars of
// shirt/stripe clipped to that same path, so a striped-kit club actually
// reads as striped instead of solid. `x`/`width` describe the path's own
// bounding box (cheaper than computing it back out of the path).
function fillKitPath(ctx, x, width, shirt, stripe) {
  if (!stripe) { ctx.fillStyle = shirt; ctx.fill(); return; }
  ctx.save();
  ctx.clip();
  const barW = width / 5; // 5 bars reads clearly as stripes at this sprite size
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = i % 2 === 0 ? shirt : stripe;
    ctx.fillRect(x + i * barW, -1000, barW + 0.5, 2000); // tall enough to cover the clip regardless of y
  }
  ctx.restore();
}

function drawPlayerSprite(ctx, cx, cy, shirt, shorts, controlled, stridePhase, skinTone, hairColor, stripe) {
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

  roundedRectPath(ctx, cx - 3.5, cy - 5, 7, 6, 1.6);
  fillKitPath(ctx, cx - 3.5, 7, shirt, stripe);
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
// Shared by every flavour of aim marker below - a dashed line from the
// carrier to a world-space point, with a solid dot at the far end.
function drawAimLine(ctx, fromX, fromY, toX, toY) {
  ctx.save();
  ctx.strokeStyle = '#ff1e1e';
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(toCanvasX(fromX), toCanvasY(fromY));
  ctx.lineTo(toCanvasX(toX), toCanvasY(toY));
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#ff1e1e';
  ctx.beginPath();
  ctx.arc(toCanvasX(toX), toCanvasY(toY), 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// How far out (world metres) the open-play shoot-joystick's feint arrow
// reaches - just needs to read clearly as a direction, not model the
// actual shot's real travel distance.
const SHOOT_JOYSTICK_MARKER_DIST = 18;

function drawAimMarker(ctx) {
  if (!G.controlled || G.ball.owner !== G.controlled) return;
  if (G.charge.shoot && G.shootDragMag > SHOOT_DRAG_THRESHOLD) {
    // Free-aimed via the Shoot joystick, in ANY situation (open play or a
    // dead ball) - takes priority over the 1D dead-ball aim below, same
    // as resolveShootAim's priority when the shot actually fires.
    const dir = norm(G.shootAimVec);
    const endX = clamp(G.controlled.pos.x + dir.x * SHOOT_JOYSTICK_MARKER_DIST, 0, PITCH_LEN);
    const endY = clamp(G.controlled.pos.y + dir.y * SHOOT_JOYSTICK_MARKER_DIST, 0, PITCH_WID);
    drawAimLine(ctx, G.controlled.pos.x, G.controlled.pos.y, endX, endY);
  } else if (G.charge.shoot && isAimableShotSituation()) {
    const team = G.teams[G.controlled.__team];
    const goalX = team.attackDir === 1 ? PITCH_LEN : 0;
    const goalY = PITCH_WID / 2;
    const markerY = goalY + G.shotAim * (GOAL_WIDTH / 2 - 0.5);
    drawAimLine(ctx, G.controlled.pos.x, G.controlled.pos.y, goalX, markerY);
  } else if (G.charge.pass && isAimableThrowinSituation()) {
    // No goal to draw toward here - just the actual thrown line, same
    // direction math as releasePass's aimed-throw-in branch, extended a
    // fixed distance so it reads clearly as an aim line rather than a dot.
    const team = G.teams[G.controlled.__team];
    const intoField = G.controlled.pos.y < PITCH_WID / 2 ? 1 : -1;
    const throwDir = rotateVec({ x: 0, y: intoField }, clamp(G.shotAim, -1, 1) * THROWIN_AIM_ANGLE * team.attackDir);
    const THROW_MARKER_DIST = 16;
    const endX = G.controlled.pos.x + throwDir.x * THROW_MARKER_DIST;
    const endY = clamp(G.controlled.pos.y + throwDir.y * THROW_MARKER_DIST, 0, PITCH_WID);
    drawAimLine(ctx, G.controlled.pos.x, G.controlled.pos.y, endX, endY);
  }
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
        drawPlayerSprite(ctx, toCanvasX(p.pos.x), toCanvasY(p.pos.y) + bob, shirt, shorts, p === G.controlled, moving ? phase : null, p.skinTone, p.hairColor, p.isGK ? null : team.stripe);
        if (tired) ctx.globalAlpha = 1;
      }
    }
    drawBallTrail(ctx, toCanvasX(G.ball.pos.x), toCanvasY(G.ball.pos.y), G.ball.vel);
    drawBallSprite(ctx, toCanvasX(G.ball.pos.x), toCanvasY(G.ball.pos.y), G.ball.spin);
    drawStaminaBar(ctx);
  }
  if (G.isNightMatch) drawFloodlights(ctx);
  drawRain(ctx);
  drawRadar(ctx);
}

// A small fixed-position minimap in the corner showing the whole pitch, both
// teams and the ball as dots - deliberately drawn in raw canvas-pixel space
// (transform reset, ignoring the camera's zoom/pan) since it's a HUD overlay,
// not part of the world the camera looks at.
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
  stepGoalReplay();
  updateDirtParticles(dt);
  updateRain(dt);
  if (G.state === STATE.PLAYING || G.state === STATE.PAUSED || G.state === STATE.GOAL || G.state === STATE.HALFTIME || G.state === STATE.FULLTIME || G.state === STATE.SHOOTOUT) render();
  requestAnimationFrame(loop);
}

// ============================================================
// UI wiring
// ============================================================
function showScreen(id) {
  ['main-menu', 'setup-screen', 'season-setup-screen', 'season-table-screen', 'cup-setup-screen', 'cup-progress-screen', 'settings-screen', 'stats-screen', 'career-slots-screen', 'career-club-screen', 'career-dashboard-screen', 'career-lineup-screen', 'career-table-screen', 'career-history-screen', 'career-transfer-screen', 'online-menu-screen', 'online-host-screen', 'online-join-screen', 'online-quickmatch-screen', 'online-teampick-screen', 'match-screen', 'subs-screen'].forEach(s => {
    document.getElementById(s).classList.toggle('hidden', s !== id);
  });
  // Single hook point for every path back to the menu (goToMainMenu's full
  // cleanup, or any of the plain "Back" buttons that just call showScreen
  // directly) - so the Continue Career card is always up to date regardless
  // of which one brought you here.
  if (id === 'main-menu') updateMenuContinueCareerCard();
  if (id === 'online-menu-screen') renderOnlineHistory();
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
  CAREER = null; // already durably saved via saveCareerSlot as you go - this just clears the in-memory reference, same as SEASON/CUP above
  teardownOnline();
  pendingSubOut = null;
  document.getElementById('pause-overlay').classList.add('hidden');
  document.getElementById('halftime-overlay').classList.add('hidden');
  document.getElementById('fulltime-overlay').classList.add('hidden');
  document.getElementById('goal-banner').classList.add('hidden');
  document.getElementById('online-lost-overlay').classList.add('hidden');
  document.getElementById('online-reconnecting-overlay').classList.add('hidden');
  document.getElementById('shootout-overlay').classList.add('hidden');
  document.getElementById('season-complete-overlay').classList.add('hidden');
  document.getElementById('cup-trophy-overlay').classList.add('hidden');
  stopSubsAutoTimer();
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
// Bronze..Invincible, in order - shifted two tiers harder than the original
// easy..champion ladder (see SKILLS/DIFFICULTY_OPPONENT_BOOST); a saved
// preference of 'easy'/'medium' from before this change no longer validates
// here and falls back to the new default rank instead.
const RANK_SKILLS = ['hard', 'expert', 'legendary', 'champion', 'grandmaster', 'legend', 'mythic', 'invincible'];

// Arrow-key difficulty browsing, same idea as the main hub's mode browser -
// armed by clicking any rank tile (see the 4 rank-tile click handlers
// below), then ArrowLeft/ArrowRight step through RANK_SKILLS one at a time
// without leaving the setup screen you're on. Only one setup screen is ever
// visible at once, so screenId just guards against a stale arm from a
// screen you've since navigated away from still responding to arrow keys.
let activeRankPicker = null; // { screenId, setupObj, render }
function armRankPicker(screenId, setupObj, render) {
  activeRankPicker = { screenId, setupObj, render };
}

const playSetup = { yourIdx: 0, oppIdx: 1, halfIdx: 1, skillKey: 'expert' };

function renderPlaySetupTeam(which) {
  const idx = which === 'your' ? playSetup.yourIdx : playSetup.oppIdx;
  const def = ALL_CLUBS[idx];
  const box = document.getElementById(which === 'your' ? 'setup-team-box' : 'setup-opp-box');
  const nameEl = document.getElementById(which === 'your' ? 'setup-team-name' : 'setup-opp-name');
  const leagueEl = document.getElementById(which === 'your' ? 'setup-team-league' : 'setup-opp-league');
  box.style.setProperty('--team-color', def.shirt);
  box.style.setProperty('--team-text', readableTextColor(def.shirt));
  styleTeamBox(box, def);
  nameEl.textContent = def.name;
  setLeagueLabel(leagueEl, def.league);
}

// Same "skip past a collision" behaviour as the old <select> onchange pair -
// cycling your team past whichever club the opponent currently is nudges the
// opponent along instead of letting you pick the same club twice.
function cyclePlaySetupTeam(which, dir) {
  if (which === 'your') {
    playSetup.yourIdx = cycleWithinLeague(playSetup.yourIdx, dir);
    if (playSetup.yourIdx === playSetup.oppIdx) playSetup.oppIdx = cycleWithinLeague(playSetup.oppIdx, dir);
  } else {
    playSetup.oppIdx = cycleWithinLeague(playSetup.oppIdx, dir);
    if (playSetup.oppIdx === playSetup.yourIdx) playSetup.oppIdx = cycleWithinLeague(playSetup.oppIdx, dir);
  }
  renderPlaySetupTeam('your');
  renderPlaySetupTeam('opp');
}

function jumpPlaySetupLeague(which, dir) {
  const key = which === 'your' ? 'yourIdx' : 'oppIdx';
  const otherKey = which === 'your' ? 'oppIdx' : 'yourIdx';
  let target = jumpToLeagueClub(playSetup[key], dir);
  if (target === playSetup[otherKey]) target = (target + 1) % ALL_CLUBS.length; // land on the same club as the other box - just take the next one
  playSetup[key] = target;
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
  if (playSetup.yourIdx === playSetup.oppIdx) playSetup.oppIdx = (playSetup.yourIdx + 1) % ALL_CLUBS.length;
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
  document.getElementById('setup-team-league-prev').onclick = () => jumpPlaySetupLeague('your', -1);
  document.getElementById('setup-team-league-next').onclick = () => jumpPlaySetupLeague('your', 1);
  document.getElementById('setup-opp-league-prev').onclick = () => jumpPlaySetupLeague('opp', -1);
  document.getElementById('setup-opp-league-next').onclick = () => jumpPlaySetupLeague('opp', 1);
  document.getElementById('setup-half-prev').onclick = () => cyclePlaySetupHalf(-1);
  document.getElementById('setup-half-next').onclick = () => cyclePlaySetupHalf(1);
  document.querySelectorAll('#setup-screen .rank-tile').forEach(tile => {
    tile.onclick = () => {
      playSetup.skillKey = tile.dataset.skill;
      renderPlaySetupRank();
      armRankPicker('setup-screen', playSetup, renderPlaySetupRank);
    };
  });
}

// ---------- Season Setup screen - same custom team/clock/rank UI as Match Setup ----------
const seasonSetup = { yourIdx: 0, halfIdx: 1, skillKey: 'expert' };

function renderSeasonSetupTeam() {
  const def = ALL_CLUBS[seasonSetup.yourIdx];
  const box = document.getElementById('season-team-box');
  box.style.setProperty('--team-color', def.shirt);
  box.style.setProperty('--team-text', readableTextColor(def.shirt));
  styleTeamBox(box, def);
  document.getElementById('season-team-name').textContent = def.name;
  setLeagueLabel(document.getElementById('season-team-league'), def.league);
}

function cycleSeasonSetupTeam(dir) {
  seasonSetup.yourIdx = cycleWithinLeague(seasonSetup.yourIdx, dir);
  renderSeasonSetupTeam();
}

function jumpSeasonSetupLeague(dir) {
  seasonSetup.yourIdx = jumpToLeagueClub(seasonSetup.yourIdx, dir);
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
  document.getElementById('season-team-league-prev').onclick = () => jumpSeasonSetupLeague(-1);
  document.getElementById('season-team-league-next').onclick = () => jumpSeasonSetupLeague(1);
  document.getElementById('season-half-prev').onclick = () => cycleSeasonSetupHalf(-1);
  document.getElementById('season-half-next').onclick = () => cycleSeasonSetupHalf(1);
  document.querySelectorAll('#season-setup-screen .rank-tile').forEach(tile => {
    tile.onclick = () => {
      seasonSetup.skillKey = tile.dataset.skill;
      renderSeasonSetupRank();
      armRankPicker('season-setup-screen', seasonSetup, renderSeasonSetupRank);
    };
  });
}

// ---------- Cup Setup screen - same custom team/clock/rank UI ----------
const cupSetup = { yourIdx: 0, halfIdx: 1, skillKey: 'expert' };

function renderCupSetupTeam() {
  const def = ALL_CLUBS[cupSetup.yourIdx];
  const box = document.getElementById('cup-team-box');
  box.style.setProperty('--team-color', def.shirt);
  box.style.setProperty('--team-text', readableTextColor(def.shirt));
  styleTeamBox(box, def);
  document.getElementById('cup-team-name').textContent = def.name;
  setLeagueLabel(document.getElementById('cup-team-league'), def.league);
}

function cycleCupSetupTeam(dir) {
  cupSetup.yourIdx = cycleWithinLeague(cupSetup.yourIdx, dir);
  renderCupSetupTeam();
}

function jumpCupSetupLeague(dir) {
  cupSetup.yourIdx = jumpToLeagueClub(cupSetup.yourIdx, dir);
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
  document.getElementById('cup-team-league-prev').onclick = () => jumpCupSetupLeague(-1);
  document.getElementById('cup-team-league-next').onclick = () => jumpCupSetupLeague(1);
  document.getElementById('cup-half-prev').onclick = () => cycleCupSetupHalf(-1);
  document.getElementById('cup-half-next').onclick = () => cycleCupSetupHalf(1);
  document.querySelectorAll('#cup-setup-screen .rank-tile').forEach(tile => {
    tile.onclick = () => {
      cupSetup.skillKey = tile.dataset.skill;
      renderCupSetupRank();
      armRankPicker('cup-setup-screen', cupSetup, renderCupSetupRank);
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
  styleTeamBox(box, def);
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
      armRankPicker('career-club-screen', careerClubSetup, renderCareerClubSetupRank);
    };
  });
}

// ---------- Career mode: slots / dashboard / transfer market rendering ----------
// Same position colour-coding convention most football games use, so the
// squad/transfer list reads at a glance instead of needing every label read.
const POSITION_COLOR = { GK: '#eab308', DEF: '#3b82f6', MID: '#22c55e', FWD: '#ef4444' };

// Retro-styled centred meeting overlay used in place of a plain browser
// confirm() for anything that changes a real player's status (Release,
// Renew - Sign gets the fuller startSignNegotiation flow below instead) -
// a moment of flavour text plus a details card, rather than a flat yes/no.
// `kind` picks the flavour pool/badge/title, `extraRows` are [label, value]
// pairs specific to that action (a sell-on fee for a release, etc.), and
// `onConfirm` only fires if Confirm is actually pressed - the caller
// doesn't need to know or care that this isn't a synchronous confirm() anymore.
const CAREER_MEETING_COPY = {
  release: {
    badge: 'SQUAD MEETING', title: 'RELEASE MEETING',
    flavor: cp => pick([
      `You call ${cp.name} into your office for a difficult conversation...`,
      `${cp.name} is told their time at the club has come to an end...`,
      `A hard meeting with ${cp.name} about their future away from the club...`,
    ]),
  },
};
let careerMeetingOnConfirm = null;
// The plain one-shot path (Release, and anything else routed through
// showCareerMeeting) - hides the overlay then runs whatever was queued.
// Named/hoisted so both the init-time wiring and showCareerMeeting itself
// can restore it onto the shared confirm button - see the comment in
// showCareerMeeting for why that restoration is needed.
function careerMeetingConfirmDispatch() {
  document.getElementById('career-meeting-overlay').classList.add('hidden');
  const cb = careerMeetingOnConfirm;
  careerMeetingOnConfirm = null;
  if (cb) cb();
}
function showCareerMeeting({ kind, cp, confirmLabel, extraRows, onConfirm }) {
  const copy = CAREER_MEETING_COPY[kind];
  document.getElementById('career-meeting-badge').textContent = copy.badge;
  document.getElementById('career-meeting-title').textContent = copy.title;
  document.getElementById('career-meeting-flavor').textContent = copy.flavor(cp);
  const rows = [
    ['Player', cp.name],
    ['Position', GROUP_LABEL[cp.group] || cp.group],
    ...(extraRows || []),
  ];
  document.getElementById('career-meeting-details').innerHTML = rows
    .map(([label, value]) => `<div class="meeting-detail-row"><span>${label}</span><span>${value}</span></div>`)
    .join('');
  // A plain one-shot confirm, not a negotiation (see startSignNegotiation) -
  // hide the negotiation-only bits and show the normal Confirm button.
  document.getElementById('career-meeting-step').classList.add('hidden');
  document.getElementById('career-meeting-length-picker').classList.add('hidden');
  document.getElementById('career-meeting-tiers').classList.add('hidden');
  const confirmBtn = document.getElementById('btn-career-meeting-confirm');
  confirmBtn.classList.remove('hidden');
  confirmBtn.disabled = false;
  confirmBtn.textContent = confirmLabel;
  confirmBtn.classList.toggle('meeting-confirm-danger', kind === 'release');
  // The negotiation flow (startSignNegotiation) drives this same button
  // through its own step-by-step onclick handlers rather than this generic
  // dispatcher (Next shouldn't close the overlay the way a one-shot Confirm
  // does) - restore the shared dispatcher here so a plain Release/Renew
  // meeting works correctly even right after a negotiation ran.
  confirmBtn.onclick = careerMeetingConfirmDispatch;
  careerMeetingOnConfirm = onConfirm;
  document.getElementById('career-meeting-overlay').classList.remove('hidden');
}

// ---------- Sign negotiation - fee talks with the club, then personal terms
// (wage + contract length) with the player's own camp, FIFA/FC-career-mode
// style, rather than a single flat "pay full asking price, take it or leave
// it" - see the meeting overlay's tier buttons/length picker, added
// specifically for this. Reuses the same overlay showCareerMeeting uses for
// Release/Renew, just driven manually step-by-step instead of through that
// one-shot helper.
// Wider spread than before (2 tiers per side of "fair") so there's a real
// low-risk/high-risk choice on both fee and wage rather than just 3 flat
// options. pct still measures the offer against value/wage, chance is that
// SPECIFIC offer's own odds - see computeNegotiationChance for how fee/wage/
// contract-length all combine into one final acceptance % at the review step.
const FEE_OFFER_TIERS = [
  { label: 'Cut-Price Bid', pct: -0.3, chance: 0.15 },
  { label: 'Lowball Bid', pct: -0.15, chance: 0.4 },
  { label: 'Fair Value', pct: 0, chance: 0.75 },
  { label: 'Over the Odds', pct: 0.15, chance: 0.92 },
  { label: 'Blow Them Away', pct: 0.3, chance: 0.99 },
];
const WAGE_OFFER_TIERS = [
  { label: 'Bargain Wage', pct: -0.3, chance: 0.15 },
  { label: 'Modest Wage', pct: -0.15, chance: 0.4 },
  { label: 'Standard Wage', pct: 0, chance: 0.75 },
  { label: 'Generous Wage', pct: 0.2, chance: 0.92 },
  { label: 'Star Wage', pct: 0.4, chance: 0.99 },
];
const CONTRACT_LENGTH_OPTIONS = [2, 3, 4, 5];
// { cp, feeTierIdx, wageTierIdx, contractYears } while a sign negotiation is
// open - nothing is offered/rolled until the final review step now (see
// resolveFullNegotiation); each step before that just records a selection.
let negotiationState = null;

function startSignNegotiation(cp) {
  if (cp.clubIdx != null && (effectiveClub(cp.clubIdx).strength || 1) - careerReputation() > BUY_REPUTATION_GAP) {
    showToast(`${cp.name}'s club won't sell to a side of your stature yet`, '#e63946');
    return;
  }
  negotiationState = { cp, feeTierIdx: null, wageTierIdx: null, contractYears: 3 };
  renderFeeNegotiationStep();
}

// Shared by both offer-picking steps - a column of buttons that just
// highlight the current selection (same idea as the contract-length picker
// already had) instead of resolving anything immediately, plus optionally
// disabling any option that's already unaffordable.
function renderTierPicker(tiersEl, tiers, selectedIdx, amountFor, unit, onSelect) {
  tiersEl.innerHTML = '';
  tiers.forEach((tier, i) => {
    const amount = amountFor(tier);
    const btn = document.createElement('button');
    btn.className = i === selectedIdx ? 'active' : '';
    const unaffordable = unit === 'm' && amount > CAREER.budget;
    btn.disabled = unaffordable;
    btn.innerHTML = `<span>${tier.label} — £${amount}${unit === 'm/yr' ? 'm/yr' : 'm'}</span><span class="tier-odds">${unaffordable ? "can't afford" : `${Math.round(tier.chance * 100)}% likely accepted`}</span>`;
    if (!unaffordable) btn.onclick = () => onSelect(i);
    tiersEl.appendChild(btn);
  });
}

function renderFeeNegotiationStep() {
  const { cp, feeTierIdx } = negotiationState;
  document.getElementById('career-meeting-badge').textContent = 'TRANSFER TALKS';
  document.getElementById('career-meeting-title').textContent = 'FEE NEGOTIATION';
  const stepEl = document.getElementById('career-meeting-step');
  stepEl.textContent = 'Step 1 of 3 — Fee';
  stepEl.classList.remove('hidden');
  document.getElementById('career-meeting-flavor').textContent = pick([
    `You open talks with ${cp.club || "the player's club"} about a fee for ${cp.name}...`,
    `Negotiations begin over a transfer fee for ${cp.name}...`,
    `${cp.name}'s club sets out their valuation as talks get underway...`,
  ]);
  document.getElementById('career-meeting-details').innerHTML = [
    ['Player', cp.name],
    ['Position', GROUP_LABEL[cp.group] || cp.group],
    ['Asking Price', `£${cp.value}m`],
    ['Your Budget', `£${CAREER.budget}m`],
  ].map(([label, value]) => `<div class="meeting-detail-row"><span>${label}</span><span>${value}</span></div>`).join('');
  document.getElementById('career-meeting-length-picker').classList.add('hidden');
  const tiersEl = document.getElementById('career-meeting-tiers');
  tiersEl.classList.remove('hidden');
  renderTierPicker(tiersEl, FEE_OFFER_TIERS, feeTierIdx, tier => Math.max(1, Math.round(cp.value * (1 + tier.pct))), 'm', i => {
    negotiationState.feeTierIdx = i;
    renderFeeNegotiationStep();
  });
  const confirmBtn = document.getElementById('btn-career-meeting-confirm');
  confirmBtn.classList.remove('hidden', 'meeting-confirm-danger');
  confirmBtn.textContent = 'Next';
  confirmBtn.disabled = feeTierIdx == null;
  confirmBtn.onclick = () => { if (negotiationState.feeTierIdx != null) renderPersonalTermsStep(); };
  document.getElementById('career-meeting-overlay').classList.remove('hidden');
}

function renderPersonalTermsStep() {
  const { cp, wageTierIdx, contractYears } = negotiationState;
  document.getElementById('career-meeting-badge').textContent = 'CONTRACT TALKS';
  document.getElementById('career-meeting-title').textContent = 'PERSONAL TERMS';
  document.getElementById('career-meeting-step').textContent = 'Step 2 of 3 — Wages & Contract';
  document.getElementById('career-meeting-flavor').textContent = pick([
    `${cp.name}'s agent joins the table to discuss wages and contract length...`,
    `With a fee offer set, talks turn to personal terms with ${cp.name}...`,
    `${cp.name} wants to talk numbers - and years - before signing...`,
  ]);
  document.getElementById('career-meeting-details').innerHTML = [
    ['Player', cp.name],
    ['Fee Offer', `£${feeOfferAmount()}m`],
  ].map(([label, value]) => `<div class="meeting-detail-row"><span>${label}</span><span>${value}</span></div>`).join('');

  const lengthEl = document.getElementById('career-meeting-length-picker');
  lengthEl.classList.remove('hidden');
  lengthEl.innerHTML = '';
  CONTRACT_LENGTH_OPTIONS.forEach(years => {
    const btn = document.createElement('button');
    btn.textContent = `${years}y`;
    btn.className = years === contractYears ? 'active' : '';
    btn.onclick = () => { negotiationState.contractYears = years; renderPersonalTermsStep(); };
    lengthEl.appendChild(btn);
  });

  const tiersEl = document.getElementById('career-meeting-tiers');
  tiersEl.classList.remove('hidden');
  renderTierPicker(tiersEl, WAGE_OFFER_TIERS, wageTierIdx, tier => Math.max(0.2, Math.round(cp.wage * (1 + tier.pct) * 10) / 10), 'm/yr', i => {
    negotiationState.wageTierIdx = i;
    renderPersonalTermsStep();
  });
  const confirmBtn = document.getElementById('btn-career-meeting-confirm');
  confirmBtn.classList.remove('hidden', 'meeting-confirm-danger');
  confirmBtn.textContent = 'Next';
  confirmBtn.disabled = wageTierIdx == null;
  confirmBtn.onclick = () => { if (negotiationState.wageTierIdx != null) renderReviewStep(); };
}

function feeOfferAmount() {
  const { cp, feeTierIdx } = negotiationState;
  return Math.max(1, Math.round(cp.value * (1 + FEE_OFFER_TIERS[feeTierIdx].pct)));
}
function wageOfferAmount() {
  const { cp, wageTierIdx } = negotiationState;
  return Math.max(0.2, Math.round(cp.wage * (1 + WAGE_OFFER_TIERS[wageTierIdx].pct) * 10) / 10);
}
// Fee and wage odds are each that offer's own standalone chance; contract
// length adds a small extra swing on top (a longer deal reads as more
// commitment, so it's a bit likelier to land than a short one) - every part
// of the package the player asked to be weighed in, combined into one final
// number rather than resolving fee and wages as two separate dice rolls.
function computeNegotiationChance() {
  const { feeTierIdx, wageTierIdx, contractYears } = negotiationState;
  const lengthFactor = 0.9 + (contractYears - 2) * 0.03;
  return clamp(FEE_OFFER_TIERS[feeTierIdx].chance * WAGE_OFFER_TIERS[wageTierIdx].chance * lengthFactor, 0.05, 0.99);
}

function renderReviewStep() {
  const { cp, contractYears } = negotiationState;
  document.getElementById('career-meeting-badge').textContent = 'FINAL OFFER';
  document.getElementById('career-meeting-title').textContent = 'REVIEW & SIGN';
  document.getElementById('career-meeting-step').textContent = 'Step 3 of 3 — Review';
  document.getElementById('career-meeting-flavor').textContent = pick([
    `Everything's on the table - review the full package before ${cp.name} decides.`,
    `One last look before you put the offer to ${cp.name} and their club.`,
    `The whole deal, laid out - here's how likely it is to get done.`,
  ]);
  const chance = computeNegotiationChance();
  document.getElementById('career-meeting-details').innerHTML = [
    ['Player', cp.name],
    ['Fee Offer', `£${feeOfferAmount()}m (${FEE_OFFER_TIERS[negotiationState.feeTierIdx].label})`],
    ['Wage Offer', `£${wageOfferAmount()}m/yr (${WAGE_OFFER_TIERS[negotiationState.wageTierIdx].label})`],
    ['Contract Length', `${contractYears}y`],
    ['Chance of Acceptance', `${Math.round(chance * 100)}%`],
  ].map(([label, value]) => `<div class="meeting-detail-row"><span>${label}</span><span>${value}</span></div>`).join('');
  document.getElementById('career-meeting-length-picker').classList.add('hidden');
  document.getElementById('career-meeting-tiers').classList.add('hidden');
  const confirmBtn = document.getElementById('btn-career-meeting-confirm');
  confirmBtn.classList.remove('hidden', 'meeting-confirm-danger');
  confirmBtn.disabled = false;
  confirmBtn.textContent = `Sign (${Math.round(chance * 100)}%)`;
  confirmBtn.onclick = resolveFullNegotiation;
}

// The single dice roll for the whole package - everything before this point
// was just choosing what to offer, nothing was actually put to the club/
// player until now (see the "sign button at the end" this was built for).
function resolveFullNegotiation() {
  if (!negotiationState) return;
  const { cp, contractYears } = negotiationState;
  const fee = feeOfferAmount();
  const wage = wageOfferAmount();
  const chance = computeNegotiationChance();
  negotiationState = null;
  if (fee > CAREER.budget) {
    showToast("You can't afford that bid", '#e63946');
    document.getElementById('career-meeting-overlay').classList.add('hidden');
    return;
  }
  if (Math.random() < chance) {
    finalizeSignNegotiation(cp, fee, wage, contractYears);
  } else {
    document.getElementById('career-meeting-overlay').classList.add('hidden');
    showToast(`${cp.club || 'The club'} and ${cp.name}'s camp turned down the full package`, '#e63946');
  }
}

function finalizeSignNegotiation(cp, fee, wage, contractYears) {
  document.getElementById('career-meeting-overlay').classList.add('hidden');
  const result = signPlayer(cp, { fee, wage, contractYears });
  if (result === true) {
    showToast(`✅ Signed ${cp.name} for £${fee}m (£${wage}m/yr, ${contractYears}y)`, '#4ade80');
    renderCareerTransferScreen();
  } else if (result === 'reputation') {
    showToast(`${cp.name}'s club won't sell to a side of your stature yet`, '#e63946');
  } else {
    showToast('Not enough budget', '#e63946');
  }
}

// ---------- Contract renewal negotiation - wage + length, no transfer fee
// (renewing your own player is a real-terms raise negotiation, not a
// purchase - see startRenewNegotiation) - reuses the same career-meeting-
// overlay/renderTierPicker machinery as the sign-negotiation flow above,
// just entering straight at the wage step since there's no fee to agree.
const RENEWAL_WAGE_TIERS = [
  { label: 'Hold Firm', pct: -0.05, chance: 0.35 },
  { label: 'Modest Rise', pct: 0.1, chance: 0.65 },
  { label: 'Fair Rise', pct: 0.25, chance: 0.85 },
  { label: 'Generous Rise', pct: 0.45, chance: 0.95 },
  { label: 'Star Terms', pct: 0.7, chance: 0.99 },
];
let renewalState = null; // { cp, wageTierIdx, contractYears } while a renewal negotiation is open

function startRenewNegotiation(cp) {
  renewalState = { cp, wageTierIdx: null, contractYears: 3 };
  renderRenewalWageStep();
}

function renewalWageAmount() {
  const { cp, wageTierIdx } = renewalState;
  return Math.max(0.2, Math.round(cp.wage * (1 + RENEWAL_WAGE_TIERS[wageTierIdx].pct) * 10) / 10);
}
// Same "fee/wage/length all feed into one number" idea as
// computeNegotiationChance, just without a fee term - length still helps a
// little (a longer commitment reads as more sincere) on top of whichever
// wage tier was offered.
function renewalChance() {
  const { wageTierIdx, contractYears } = renewalState;
  const lengthFactor = 0.9 + (contractYears - 2) * 0.03;
  return clamp(RENEWAL_WAGE_TIERS[wageTierIdx].chance * lengthFactor, 0.05, 0.99);
}

function renderRenewalWageStep() {
  const { cp, wageTierIdx, contractYears } = renewalState;
  document.getElementById('career-meeting-badge').textContent = 'CONTRACT TALKS';
  document.getElementById('career-meeting-title').textContent = 'RENEWAL';
  const stepEl = document.getElementById('career-meeting-step');
  stepEl.textContent = 'Step 1 of 2 — Wages & Contract';
  stepEl.classList.remove('hidden');
  document.getElementById('career-meeting-flavor').textContent = pick([
    `${cp.name}'s agent sits down to discuss a new deal...`,
    `Renewal talks begin with ${cp.name}...`,
    `${cp.name} wants to know what you're offering to stay...`,
  ]);
  document.getElementById('career-meeting-details').innerHTML = [
    ['Player', cp.name],
    ['Current Wage', `£${cp.wage}m/yr`],
    ['Contract Left', `${cp.contractYears != null ? cp.contractYears : '?'}y`],
  ].map(([label, value]) => `<div class="meeting-detail-row"><span>${label}</span><span>${value}</span></div>`).join('');

  const lengthEl = document.getElementById('career-meeting-length-picker');
  lengthEl.classList.remove('hidden');
  lengthEl.innerHTML = '';
  CONTRACT_LENGTH_OPTIONS.forEach(years => {
    const btn = document.createElement('button');
    btn.textContent = `${years}y`;
    btn.className = years === contractYears ? 'active' : '';
    btn.onclick = () => { renewalState.contractYears = years; renderRenewalWageStep(); };
    lengthEl.appendChild(btn);
  });

  const tiersEl = document.getElementById('career-meeting-tiers');
  tiersEl.classList.remove('hidden');
  renderTierPicker(tiersEl, RENEWAL_WAGE_TIERS, wageTierIdx, tier => Math.max(0.2, Math.round(cp.wage * (1 + tier.pct) * 10) / 10), 'm/yr', i => {
    renewalState.wageTierIdx = i;
    renderRenewalWageStep();
  });
  const confirmBtn = document.getElementById('btn-career-meeting-confirm');
  confirmBtn.classList.remove('hidden', 'meeting-confirm-danger');
  confirmBtn.textContent = 'Next';
  confirmBtn.disabled = wageTierIdx == null;
  confirmBtn.onclick = () => { if (renewalState.wageTierIdx != null) renderRenewalReviewStep(); };
  document.getElementById('career-meeting-overlay').classList.remove('hidden');
}

function renderRenewalReviewStep() {
  const { cp, contractYears } = renewalState;
  document.getElementById('career-meeting-badge').textContent = 'FINAL OFFER';
  document.getElementById('career-meeting-title').textContent = 'REVIEW & RENEW';
  document.getElementById('career-meeting-step').textContent = 'Step 2 of 2 — Review';
  document.getElementById('career-meeting-flavor').textContent = `One last look before ${cp.name} decides whether to sign a new deal.`;
  const chance = renewalChance();
  document.getElementById('career-meeting-details').innerHTML = [
    ['Player', cp.name],
    ['New Wage', `£${renewalWageAmount()}m/yr (${RENEWAL_WAGE_TIERS[renewalState.wageTierIdx].label})`],
    ['Contract Length', `${contractYears}y`],
    ['Chance of Acceptance', `${Math.round(chance * 100)}%`],
  ].map(([label, value]) => `<div class="meeting-detail-row"><span>${label}</span><span>${value}</span></div>`).join('');
  document.getElementById('career-meeting-length-picker').classList.add('hidden');
  document.getElementById('career-meeting-tiers').classList.add('hidden');
  const confirmBtn = document.getElementById('btn-career-meeting-confirm');
  confirmBtn.classList.remove('hidden', 'meeting-confirm-danger');
  confirmBtn.disabled = false;
  confirmBtn.textContent = `Offer New Deal (${Math.round(chance * 100)}%)`;
  confirmBtn.onclick = resolveRenewalNegotiation;
}

function resolveRenewalNegotiation() {
  if (!renewalState) return;
  const { cp, contractYears } = renewalState;
  const wage = renewalWageAmount();
  const chance = renewalChance();
  renewalState = null;
  document.getElementById('career-meeting-overlay').classList.add('hidden');
  if (Math.random() < chance) {
    cp.contractYears = contractYears;
    cp.wage = wage;
    saveCareerSlot(CAREER.slot, CAREER);
    showToast(`✅ ${cp.name} signed a new ${contractYears}-year deal at £${wage}m/yr`, '#4ade80');
    renderCareerLineupScreen();
  } else {
    showToast(`${cp.name}'s camp turned down the offer - they want more to stay`, '#e63946');
  }
}

function formatCareerPlayerRow(cp, actionLabel, actionHandler) {
  const card = document.createElement('div');
  card.className = 'player-card';
  card.style.setProperty('--pos-color', POSITION_COLOR[cp.group] || '#64748b');
  const detail = cp.league ? `${cp.group}, age ${cp.age} — ${cp.club} (${cp.league})` : `${cp.group}, age ${cp.age}`;
  const contract = cp.contractYears != null ? ` — ${cp.contractYears}y left` : '';
  const wage = cp.wage != null ? `, £${cp.wage}m/yr` : '';
  const ratings = computePlayerRatings(cp);
  const ovrClass = ratings.overall >= 85 ? 'ovr-elite' : ratings.overall >= 75 ? 'ovr-good' : ratings.overall >= 60 ? 'ovr-mid' : 'ovr-low';
  const subStats = (ratings.isGK ? [
    ['DIV', ratings.diving], ['HAN', ratings.handling], ['KIC', ratings.kicking],
    ['REF', ratings.reflexes], ['POS', ratings.positioning], ['STA', ratings.stamina],
  ] : [
    ['SPD', ratings.speed], ['SHO', ratings.shooting], ['PAS', ratings.passing],
    ['DRI', ratings.dribbling], ['TCK', ratings.tackling], ['STR', ratings.strength], ['STA', ratings.stamina],
  ]).map(([label, val]) => `<span class="substat"><b>${val}</b>${label}</span>`).join('');
  card.innerHTML = `
    <span class="player-ovr ${ovrClass}">${ratings.overall}</span>
    <span><span class="player-name">${cp.name}</span><span class="player-meta">${detail} — value £${cp.value}m${wage}${contract}${cp.careerGoals ? ` — ${cp.careerGoals} career goal${cp.careerGoals === 1 ? '' : 's'}` : ''}</span><span class="player-substats">${subStats}</span></span>`;
  const btn = document.createElement('button');
  btn.textContent = actionLabel;
  btn.onclick = actionHandler;
  card.appendChild(btn);
  return card;
}

// Same player-card look as the Career squad screens (formatCareerPlayerRow -
// OVR badge, name, position, six sub-stats), for a live MATCH player object
// instead of a persistent career one - see computePlayerRatings' cp.id/idx
// fallback, which is what makes reusing it here safe. Adds a status strip
// above the card itself: current in-match stamina (a live bar, not the
// static Stamina sub-stat below it) and an injury/card badge if either
// applies - exactly what you'd actually want to see before subbing someone.
function formatMatchPlayerRow(p, actionLabel, actionHandler, opts) {
  const wrap = document.createElement('div');
  wrap.className = 'sub-player-row' + (opts && opts.selected ? ' sub-row-selected' : '');

  const staminaPct = Math.round(clamp(p.stamina != null ? p.stamina : 1, 0, 1) * 100);
  const staminaTier = staminaPct > 60 ? 'high' : staminaPct > 30 ? 'mid' : 'low';
  const status = document.createElement('div');
  status.className = 'sub-status-row';
  status.innerHTML = `
    <div class="sub-stamina-bar"><div class="sub-stamina-fill sub-stamina-${staminaTier}" style="width:${staminaPct}%"></div></div>
    <span class="sub-stamina-pct">${staminaPct}%</span>
    ${p.injured ? '<span class="sub-injury-badge">\u{1FA79} Injured</span>' : ''}
    ${p.cardLevel === 1 ? '<span class="sub-card-badge">\u{1F7E8}</span>' : ''}
    ${p.cardLevel === 2 ? '<span class="sub-card-badge">\u{1F7E5}</span>' : ''}
  `;
  wrap.appendChild(status);

  const card = document.createElement('div');
  card.className = 'player-card';
  card.style.setProperty('--pos-color', POSITION_COLOR[p.group] || '#64748b');
  const ratings = computePlayerRatings(p);
  const ovrClass = ratings.overall >= 85 ? 'ovr-elite' : ratings.overall >= 75 ? 'ovr-good' : ratings.overall >= 60 ? 'ovr-mid' : 'ovr-low';
  const subStats = (ratings.isGK ? [
    ['DIV', ratings.diving], ['HAN', ratings.handling], ['KIC', ratings.kicking],
    ['REF', ratings.reflexes], ['POS', ratings.positioning], ['STA', ratings.stamina],
  ] : [
    ['SPD', ratings.speed], ['SHO', ratings.shooting], ['PAS', ratings.passing],
    ['DRI', ratings.dribbling], ['TCK', ratings.tackling], ['STR', ratings.strength], ['STA', ratings.stamina],
  ]).map(([label, val]) => `<span class="substat"><b>${val}</b>${label}</span>`).join('');
  const name = playerLabel(p);
  const ageText = p.age != null ? `, age ${p.age}` : '';
  card.innerHTML = `
    <span class="player-ovr ${ovrClass}">${ratings.overall}</span>
    <span><span class="player-name">${name}</span><span class="player-meta">${GROUP_LABEL[p.group] || p.group}${ageText}${p.goals ? ` — ${p.goals} goal${p.goals === 1 ? '' : 's'} today` : ''}</span><span class="player-substats">${subStats}</span></span>`;
  const btn = document.createElement('button');
  btn.textContent = actionLabel;
  btn.disabled = !!(opts && opts.disabled);
  btn.onclick = actionHandler;
  card.appendChild(btn);
  wrap.appendChild(card);
  return wrap;
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
  // save), it was silently lost. Checking it here instead means it pops up
  // the moment the dashboard renders, however the season actually ended -
  // a blocking overlay you have to close, rather than a button you might
  // never notice or click.
  if (CAREER.lastSeasonSummary) {
    const summary = CAREER.lastSeasonSummary;
    CAREER.lastSeasonSummary = null;
    showSeasonCompleteOverlay(summary);
  }
  // Last result updates instantly from the match log - rendered fresh every
  // time the dashboard renders rather than queued, so mashing Sim to blow
  // through fixtures never leaves it lagging behind (unlike the toast queue,
  // which only shows one at a time with a fixed delay between each).
  const lastResultEl = document.getElementById('career-last-result');
  const lastMatch = (CAREER.matchLog || [])[CAREER.matchLog.length - 1];
  if (lastMatch) {
    const opp = ALL_CLUBS[lastMatch.oppIdx] ? ALL_CLUBS[lastMatch.oppIdx].name : 'Unknown';
    lastResultEl.textContent = `Last: ${lastMatch.competition} - ${club.name} ${lastMatch.gf}-${lastMatch.ga} ${opp}`;
    lastResultEl.style.setProperty('--result-color', MATCHLOG_RESULT_COLOR[lastMatch.result] || '#9ca3af');
    lastResultEl.classList.remove('hidden');
  } else {
    lastResultEl.classList.add('hidden');
  }
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
    fixtureEl.textContent = `vs ${fixtureOpponentLabel(opp.name)}`;
    fixtureEl.title = `vs ${opp.name}`; // full name still available on hover/long-press if it got abbreviated
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
  if (!canPlayGroup(cp, slot.group)) {
    showToast(`${cp.name} plays ${GROUP_LABEL[cp.group]}, not ${GROUP_LABEL[slot.group]}`, '#e63946');
    return;
  }
  if (slot.group !== cp.group) {
    showToast(`${cp.name} is out of position at ${GROUP_LABEL[slot.group]} - a bit less effective there`, '#eab308');
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
    // A starter whose contract needs sorting gets a Renew button right under
    // their pitch marker too, not just down in the reserves list - same
    // negotiation flow (startRenewNegotiation) either way.
    if (ctx === CAREER && cp && cp.contractYears != null && cp.contractYears <= 1) {
      const renewBtn = document.createElement('button');
      renewBtn.className = 'formation-player-renew-btn';
      renewBtn.textContent = 'Renew';
      renewBtn.onclick = (e) => {
        e.stopPropagation(); // don't also trigger the marker's own click-to-select/swap handler below
        startRenewNegotiation(cp);
      };
      marker.appendChild(renewBtn);
    }
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
        showCareerMeeting({
          kind: 'release', cp, confirmLabel: 'Release',
          extraRows: [['Sell-on fee', `£${Math.round(cp.value * 0.5)}m`]],
          onConfirm: () => {
            releasePlayer(cp);
            renderCareerLineupScreen();
          },
        });
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
      // Only offered once it's actually worth worrying about - no point
      // cluttering every card with a Renew button years before it matters.
      if (cp.contractYears != null && cp.contractYears <= 1) {
        const renewBtn = document.createElement('button');
        renewBtn.className = 'career-lineup-start-btn';
        renewBtn.textContent = 'Renew';
        renewBtn.onclick = () => startRenewNegotiation(cp);
        actions.appendChild(renewBtn);
      }
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
// key -> [display name, whether it needs the actual league's domestic cup name]
const CAREER_COMPETITION_DISPLAY = {
  facup: (league) => DOMESTIC_CUP_NAME[league] || 'Domestic Cup',
  leaguecup: () => 'League Cup',
  ucl: () => 'Champions League',
  uel: () => 'Europa League',
};
function showSeasonCompleteOverlay(summary) {
  const club = ALL_CLUBS[CAREER.clubIdx];
  document.getElementById('season-complete-club').textContent = `${club.name} — Season ${summary.season} (${summary.league})`;
  const badges = [];
  if (summary.champion) badges.push('<span class="career-trophy-badge">🏆 League Champions</span>');
  if (summary.trophies.facup) badges.push(`<span class="career-trophy-badge">🏆 ${DOMESTIC_CUP_NAME[summary.league] || 'Domestic Cup'}</span>`);
  if (summary.trophies.leaguecup) badges.push('<span class="career-trophy-badge">🏆 League Cup</span>');
  if (summary.trophies.ucl) badges.push('<span class="career-trophy-badge">🏆 Champions League</span>');
  if (summary.trophies.uel) badges.push('<span class="career-trophy-badge">🏆 Europa League</span>');
  if (summary.promoted) badges.push('<span class="career-trophy-badge promo">⬆️ Promoted</span>');
  if (summary.relegated) badges.push('<span class="career-trophy-badge releg">⬇️ Relegated</span>');
  document.getElementById('season-complete-trophies').innerHTML = badges.join('');

  // Every cup/continental competition actually played this season - won, or
  // knocked out at which round. eliminations may be missing on an old save
  // from before this existed (Object.assign-style default via `|| {}`), in
  // which case this section just quietly shows nothing rather than guessing.
  const eliminations = summary.eliminations || {};
  const compRows = Object.keys(CAREER_COMPETITION_DISPLAY).map(key => {
    const name = CAREER_COMPETITION_DISPLAY[key](summary.league);
    if (summary.trophies[key]) {
      return `<div class="season-complete-comp-row"><span>${name}</span><span class="comp-result-won">🏆 Won</span></div>`;
    }
    if (eliminations[key]) {
      return `<div class="season-complete-comp-row"><span>${name}</span><span class="comp-result-out">Out — ${eliminations[key]}</span></div>`;
    }
    return null; // never entered/played this season - not shown at all
  }).filter(Boolean);
  document.getElementById('season-complete-competitions').innerHTML = compRows.join('');

  const r = summary.record;
  const stat = (label, value) => `<div class="season-stat-chip"><span class="stat-value">${value}</span><span class="stat-label">${label}</span></div>`;
  document.getElementById('season-complete-stats').innerHTML =
    stat('Position', `${summary.finalRank} of ${summary.leagueSize}`) + stat('Points', r.points) +
    stat('Played', r.played) + stat('Won', r.won) + stat('Drawn', r.drawn) + stat('Lost', r.lost) +
    stat('Scored', r.gf) + stat('Conceded', r.ga);
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

// Which tab of the Transfer Market screen is showing - 'buy' (the league/
// club/position drill-down below) or 'offers' (incoming offers on your own
// players, see generateIncomingOffers/resolveOffer). Set explicitly by the
// tab buttons, and defaulted sensibly (to 'offers' if any are pending) the
// moment the screen is opened fresh - see btn-career-transfers' own handler.
let careerMarketTab = 'buy';

// Transfer Market navigation - League -> Club -> Position, browsed the same
// swipeable/arrow-key/dot way as the main hub's mode-browser (see
// bindCarouselSwipe/goToCarouselIdx). level tracks which of the three views
// is showing; leagueIdx/clubIdx/posIdx index into whatever the CURRENT
// filtered lists are (marketLeagueEntries()/marketClubEntries()/
// marketPositionsForCurrent()) - those are always re-derived fresh rather
// than cached, so signing a player just narrows the lists in place instead
// of needing a separate resync step.
let marketNav = { level: 'league', leagueIdx: 0, clubIdx: 0, posIdx: 0 };
const MARKET_POSITIONS = [
  { key: 'GK', label: 'Goalkeepers' },
  { key: 'DEF', label: 'Defenders' },
  { key: 'MID', label: 'Midfielders' },
  { key: 'FWD', label: 'Attackers' },
];

// One entry per league with a signable player, plus a Free Agents entry -
// Free Agents has no club level of its own (skips straight to positions,
// see enterMarketLeague).
function marketLeagueEntries() {
  const pool = getTransferPool();
  const leagues = [...new Set(pool.filter(cp => cp.league).map(cp => cp.league))];
  const entries = leagues.map(name => ({ key: name, label: name, isFreeAgents: false }));
  if (pool.some(cp => !cp.league)) entries.push({ key: 'free-agents', label: 'Free Agents', isFreeAgents: true });
  return entries;
}
// Every club WITHIN one league that currently has a signable player,
// sorted alphabetically - an array of clubIdx (not club defs), so callers
// can look up ALL_CLUBS[idx] alongside a live signable-player count.
function marketClubEntries(leagueKey) {
  const pool = getTransferPool().filter(cp => cp.league === leagueKey);
  const clubIdxs = [...new Set(pool.filter(cp => cp.clubIdx != null).map(cp => cp.clubIdx))];
  return clubIdxs.sort((a, b) => ALL_CLUBS[a].name.localeCompare(ALL_CLUBS[b].name));
}
// The signable players for whichever league/club (or Free Agents) is
// currently selected.
function marketPlayersForCurrent() {
  const league = marketLeagueEntries()[marketNav.leagueIdx];
  if (!league) return [];
  let pool = getTransferPool().filter(cp => league.isFreeAgents ? !cp.league : cp.league === league.key);
  if (!league.isFreeAgents) {
    const clubIdx = marketClubEntries(league.key)[marketNav.clubIdx];
    pool = pool.filter(cp => cp.clubIdx === clubIdx);
  }
  return pool;
}
// The GK/DEF/MID/FWD entries that actually have a signable player right
// now, for whichever club (or Free Agents) is currently selected.
function marketPositionsForCurrent() {
  const pool = marketPlayersForCurrent();
  return MARKET_POSITIONS.filter(pos => pool.some(cp => cp.group === pos.key));
}

// Shared slide/dots/arrow-visibility driver for all three carousels below -
// same idea as the main hub's goToModePage, generalised by an id prefix
// instead of one hardcoded set of element ids.
function goToCarouselIdx(prefix, idx, count, instant) {
  const clamped = clamp(idx, 0, Math.max(0, count - 1));
  const track = document.getElementById(`${prefix}-track`);
  // Pixel-based, not a "%" transform - a % translateX resolves against the
  // TRACK's own width (which is N pages wide, growing with the list), not
  // one page's worth, so "100%" overshot by a bit more every extra club in
  // the list - matches bindCarouselSwipe's drag math, which already used
  // clientWidth correctly for exactly this reason.
  const pageWidth = track.parentElement.clientWidth;
  if (instant) track.style.transition = 'none';
  track.style.transform = `translateX(-${clamped * pageWidth}px)`;
  if (instant) { void track.offsetHeight; track.style.transition = ''; }
  const dotsEl = document.getElementById(`${prefix}-dots`);
  if (dotsEl) dotsEl.querySelectorAll('.mode-dot').forEach((d, i) => d.classList.toggle('active', i === clamped));
  const prevBtn = document.getElementById(`${prefix}-prev`);
  const nextBtn = document.getElementById(`${prefix}-next`);
  if (prevBtn) prevBtn.classList.toggle('hidden', clamped === 0);
  if (nextBtn) nextBtn.classList.toggle('hidden', clamped === count - 1);
  return clamped;
}
function renderMarketDots(prefix, count, onClick) {
  const dotsEl = document.getElementById(`${prefix}-dots`);
  if (!dotsEl) return;
  dotsEl.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const dot = document.createElement('button');
    dot.className = 'mode-dot';
    dot.onclick = () => onClick(i);
    dotsEl.appendChild(dot);
  }
}
// Reusable drag-to-swipe binding, same interaction model as the main hub's
// mode-browser (bindModeBrowserSwipe) - generalised so the Market's three
// nested carousels don't each need their own copy of the drag math. Scoped
// to the track's own rendered width (not window.innerWidth like the hub
// uses) since these carousels live inside a panel, not a full-viewport page.
function bindCarouselSwipe(prefix, getIdx, getCount, goTo) {
  const track = document.getElementById(`${prefix}-track`);
  const SWIPE_THRESHOLD = 60;
  let startX = null, startY = null, dragging = false, decided = false, horizontal = false;
  const onMove = (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (!decided) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      decided = true;
      horizontal = Math.abs(dx) > Math.abs(dy);
      if (horizontal) track.style.transition = 'none';
    }
    if (!horizontal) return;
    e.preventDefault();
    track.style.transform = `translateX(${-getIdx() * track.parentElement.clientWidth + dx}px)`;
  };
  const onUp = (e) => {
    if (!dragging) return;
    dragging = false;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    track.style.transition = '';
    if (horizontal) {
      const dx = e.clientX - startX;
      if (dx < -SWIPE_THRESHOLD) goTo(getIdx() + 1);
      else if (dx > SWIPE_THRESHOLD) goTo(getIdx() - 1);
      else goTo(getIdx());
    }
  };
  track.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return; // don't hijack a drag that starts on a real button (Enter/Sign/etc.)
    startX = e.clientX; startY = e.clientY;
    dragging = true; decided = false; horizontal = false;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
}

function showMarketView(level) {
  marketNav.level = level;
  document.getElementById('market-league-view').classList.toggle('hidden', level !== 'league');
  document.getElementById('market-club-view').classList.toggle('hidden', level !== 'club');
  document.getElementById('market-position-view').classList.toggle('hidden', level !== 'position');
}

function goToMarketLeague(idx, instant) {
  marketNav.leagueIdx = goToCarouselIdx('market-league', idx, marketLeagueEntries().length, instant);
}
function goToMarketClub(idx, instant) {
  const league = marketLeagueEntries()[marketNav.leagueIdx];
  marketNav.clubIdx = goToCarouselIdx('market-club', idx, league ? marketClubEntries(league.key).length : 0, instant);
}
function goToMarketPosition(idx, instant) {
  marketNav.posIdx = goToCarouselIdx('market-position', idx, marketPositionsForCurrent().length, instant);
  document.querySelectorAll('#market-position-tabs .market-position-tab').forEach((tab, i) => tab.classList.toggle('active', i === marketNav.posIdx));
}

function enterMarketLeague(idx) {
  const entries = marketLeagueEntries();
  if (!entries.length) return;
  marketNav.leagueIdx = clamp(idx, 0, entries.length - 1);
  const league = entries[marketNav.leagueIdx];
  marketNav.clubIdx = 0;
  marketNav.posIdx = 0;
  // renderMarketClubs only flips the visible view to 'club' once
  // marketNav.level already says 'club' (it also gets called on every
  // plain re-render, where the level must NOT change) - has to be set
  // here, before calling it, or pressing Enter did all the rendering work
  // but never actually switched off the league view.
  if (league.isFreeAgents) { marketNav.level = 'position'; renderMarketPositions(); }
  else { marketNav.level = 'club'; renderMarketClubs(); }
}
function enterMarketClub(idx) {
  const league = marketLeagueEntries()[marketNav.leagueIdx];
  if (!league) return;
  const clubIdxs = marketClubEntries(league.key);
  if (!clubIdxs.length) return;
  marketNav.clubIdx = clamp(idx, 0, clubIdxs.length - 1);
  marketNav.posIdx = 0;
  marketNav.level = 'position';
  renderMarketPositions();
}

function renderMarketLeagues() {
  const entries = marketLeagueEntries();
  const track = document.getElementById('market-league-track');
  track.innerHTML = '';
  if (!entries.length) {
    track.innerHTML = '<p class="hint-text">No players available to sign right now.</p>';
    document.getElementById('market-league-dots').innerHTML = '';
    showMarketView('league');
    return;
  }
  marketNav.leagueIdx = clamp(marketNav.leagueIdx, 0, entries.length - 1);
  const pool = getTransferPool();
  entries.forEach((entry, i) => {
    const page = document.createElement('div');
    page.className = 'market-league-page';
    const playerCount = pool.filter(cp => entry.isFreeAgents ? !cp.league : cp.league === entry.key).length;
    const clubCount = entry.isFreeAgents ? null : marketClubEntries(entry.key).length;
    page.innerHTML = `
      <h2>${entry.label}</h2>
      <p class="market-league-sub">${clubCount != null ? `${clubCount} club${clubCount === 1 ? '' : 's'} &middot; ` : ''}${playerCount} player${playerCount === 1 ? '' : 's'} available</p>
      <button class="mode-enter-btn">Enter ${entry.isFreeAgents ? 'Free Agents' : 'League'}</button>
    `;
    page.querySelector('.mode-enter-btn').onclick = () => enterMarketLeague(i);
    track.appendChild(page);
  });
  renderMarketDots('market-league-dots', entries.length, (i) => goToMarketLeague(i));
  goToMarketLeague(marketNav.leagueIdx, true);
  if (marketNav.level === 'league') showMarketView('league');
  else if (marketNav.level === 'club') renderMarketClubs();
  else renderMarketPositions();
}

function renderMarketClubs() {
  const entries = marketLeagueEntries();
  const league = entries[marketNav.leagueIdx];
  if (!league || league.isFreeAgents) { renderMarketPositions(); return; }
  const clubIdxs = marketClubEntries(league.key);
  if (!clubIdxs.length) { showMarketView('league'); return; } // league emptied out (its last signable player was just bought) - bounce back
  marketNav.clubIdx = clamp(marketNav.clubIdx, 0, clubIdxs.length - 1);
  const track = document.getElementById('market-club-track');
  track.innerHTML = '';
  const pool = getTransferPool();
  clubIdxs.forEach((clubIdx, i) => {
    const club = ALL_CLUBS[clubIdx];
    const count = pool.filter(cp => cp.clubIdx === clubIdx && cp.league === league.key).length;
    const page = document.createElement('div');
    page.className = 'market-club-page team-box';
    page.style.setProperty('--team-color', club.shirt);
    page.style.setProperty('--team-text', readableTextColor(club.shirt));
    styleTeamBox(page, club);
    page.innerHTML = `
      <div class="team-box-flair" aria-hidden="true"></div>
      <span class="team-box-name market-club-page-name">${club.name}</span>
      <p class="market-club-page-count">${count} player${count === 1 ? '' : 's'} available</p>
      <button class="mode-enter-btn">View Squad</button>
    `;
    page.querySelector('.mode-enter-btn').onclick = () => enterMarketClub(i);
    track.appendChild(page);
  });
  renderMarketDots('market-club-dots', clubIdxs.length, (i) => goToMarketClub(i));
  goToMarketClub(marketNav.clubIdx, true);
  if (marketNav.level === 'club') showMarketView('club');
  else if (marketNav.level === 'position') renderMarketPositions();
}

// A short scouting-style blurb underneath each player card - the "more
// detailed value and description" these position pages carry that the old
// flat list didn't.
function marketPlayerBlurb(cp) {
  const ratings = computePlayerRatings(cp);
  const tier = ratings.overall >= 85 ? 'a world-class' : ratings.overall >= 75 ? 'a top-quality' : ratings.overall >= 60 ? 'a solid squad' : 'a developing';
  const ageWord = cp.age < 21 ? 'a young prospect with plenty of room to grow' : cp.age <= 29 ? 'in their prime years' : 'an experienced, veteran presence';
  const source = cp.league ? `Valued at £${cp.value}m by ${cp.club || 'their club'}` : `A free agent valued around £${cp.value}m`;
  return `${tier.charAt(0).toUpperCase()}${tier.slice(1)} ${(GROUP_LABEL[cp.group] || cp.group).toLowerCase()}, ${ageWord}. ${source}, likely to command wages around £${cp.wage}m/yr.`;
}
function formatMarketPlayerRow(cp) {
  const wrap = document.createElement('div');
  wrap.className = 'market-player-wrap';
  wrap.appendChild(formatCareerPlayerRow(cp, `Sign £${cp.value}m`, () => startSignNegotiation(cp)));
  const blurb = document.createElement('p');
  blurb.className = 'market-player-blurb';
  blurb.textContent = marketPlayerBlurb(cp);
  wrap.appendChild(blurb);
  return wrap;
}

function renderMarketPositions() {
  const entries = marketLeagueEntries();
  const league = entries[marketNav.leagueIdx];
  if (!league) { showMarketView('league'); return; }
  let clubName;
  if (league.isFreeAgents) {
    clubName = 'Free Agents';
  } else {
    const clubIdx = marketClubEntries(league.key)[marketNav.clubIdx];
    if (clubIdx == null) { renderMarketClubs(); return; }
    clubName = ALL_CLUBS[clubIdx].name;
  }
  document.getElementById('market-position-club-name').textContent = clubName;
  document.getElementById('market-position-back-label').textContent = league.isFreeAgents ? 'Leagues' : 'Clubs';
  const pool = marketPlayersForCurrent();
  const positions = MARKET_POSITIONS.filter(pos => pool.some(cp => cp.group === pos.key));
  const tabsEl = document.getElementById('market-position-tabs');
  const track = document.getElementById('market-position-track');
  tabsEl.innerHTML = '';
  track.innerHTML = '';
  if (!positions.length) {
    track.innerHTML = '<p class="hint-text">No signable players left here.</p>';
    showMarketView('position');
    return;
  }
  marketNav.posIdx = clamp(marketNav.posIdx, 0, positions.length - 1);
  positions.forEach((pos, i) => {
    const tab = document.createElement('button');
    tab.className = 'market-position-tab' + (i === marketNav.posIdx ? ' active' : '');
    tab.textContent = pos.label;
    tab.onclick = () => goToMarketPosition(i);
    tabsEl.appendChild(tab);

    const page = document.createElement('div');
    page.className = 'market-position-page';
    // Each position gets its own accent colour (same POSITION_COLOR every
    // player-card already uses) and a real page header, so swiping between
    // GK/DEF/MID/FWD reads as moving between distinct pages instead of just
    // re-filtering the same plain list.
    page.style.setProperty('--pos-accent', POSITION_COLOR[pos.key] || '#64748b');
    const players = pool.filter(cp => cp.group === pos.key);
    const header = document.createElement('div');
    header.className = 'market-position-page-header';
    header.innerHTML = `<h2>${pos.label}</h2><p>${players.length} player${players.length === 1 ? '' : 's'} available</p>`;
    page.appendChild(header);
    players.forEach(cp => page.appendChild(formatMarketPlayerRow(cp)));
    track.appendChild(page);
  });
  goToMarketPosition(marketNav.posIdx, true);
  showMarketView('position');
}

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
  renderMarketLeagues();
}

document.addEventListener('DOMContentLoaded', () => {
  populateSetupScreen();
  populateSeasonSetupScreen();
  populateCupSetupScreen();

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
  document.getElementById('btn-online-reconnect-give-up').onclick = () => { goToMainMenu(); };

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

  document.getElementById('btn-online-quickmatch').onclick = () => {
    SFX.warmup();
    showScreen('online-quickmatch-screen');
    startQuickMatch();
  };
  document.getElementById('btn-online-quickmatch-back').onclick = () => { teardownOnline(); showScreen('online-menu-screen'); };
  // Codes are always generated upper-case (see relay-server's ROOM_ALPHABET)
  // and matched case-insensitively either way - this just makes what you see
  // as you type match that, instead of showing lowercase until you hit Join.
  document.getElementById('online-join-code-input').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase();
  });

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
    renderCareerDashboard(); // also pops the season-complete overlay itself, if that fixture ended the season
  };
  document.getElementById('btn-career-transfers').onclick = () => {
    careerMarketTab = (CAREER.incomingOffers || []).length > 0 ? 'offers' : 'buy';
    marketNav = { level: 'league', leagueIdx: 0, clubIdx: 0, posIdx: 0 };
    renderCareerTransferScreen();
    showScreen('career-transfer-screen');
  };
  document.getElementById('btn-career-transfer-back').onclick = () => { showCareerDashboard(); };
  document.getElementById('market-club-back').onclick = () => showMarketView('league');
  document.getElementById('market-position-back').onclick = () => {
    const league = marketLeagueEntries()[marketNav.leagueIdx];
    showMarketView(league && league.isFreeAgents ? 'league' : 'club');
  };
  document.getElementById('market-league-prev').onclick = () => goToMarketLeague(marketNav.leagueIdx - 1);
  document.getElementById('market-league-next').onclick = () => goToMarketLeague(marketNav.leagueIdx + 1);
  document.getElementById('market-club-prev').onclick = () => goToMarketClub(marketNav.clubIdx - 1);
  document.getElementById('market-club-next').onclick = () => goToMarketClub(marketNav.clubIdx + 1);
  document.getElementById('market-position-prev').onclick = () => goToMarketPosition(marketNav.posIdx - 1);
  document.getElementById('market-position-next').onclick = () => goToMarketPosition(marketNav.posIdx + 1);
  bindCarouselSwipe('market-league', () => marketNav.leagueIdx, () => marketLeagueEntries().length, goToMarketLeague);
  bindCarouselSwipe('market-club', () => marketNav.clubIdx, () => {
    const league = marketLeagueEntries()[marketNav.leagueIdx];
    return league ? marketClubEntries(league.key).length : 0;
  }, goToMarketClub);
  bindCarouselSwipe('market-position', () => marketNav.posIdx, () => marketPositionsForCurrent().length, goToMarketPosition);
  document.getElementById('btn-career-meeting-cancel').onclick = () => {
    document.getElementById('career-meeting-overlay').classList.add('hidden');
    careerMeetingOnConfirm = null;
    negotiationState = null; // walking away mid-negotiation (fee agreed but personal terms not, etc.) drops the whole thing, not just the current step
    renewalState = null; // same idea, for a renewal negotiation walked away from mid-flow
    // Next time the shared overlay opens it might be a plain one-shot
    // meeting (Release) rather than another negotiation - make sure it
    // doesn't inherit whatever step-specific onclick a negotiation left on
    // this button.
    document.getElementById('btn-career-meeting-confirm').onclick = careerMeetingConfirmDispatch;
  };
  document.getElementById('btn-career-meeting-confirm').onclick = careerMeetingConfirmDispatch;
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
  document.getElementById('btn-career-table-back').onclick = () => { showCareerDashboard(); };
  document.getElementById('career-club-box').onclick = () => { renderCareerHistoryScreen(); showScreen('career-history-screen'); };
  document.getElementById('btn-career-history-back').onclick = () => { showCareerDashboard(); };
  document.getElementById('btn-career-save-exit').onclick = () => { saveCareerSlot(CAREER.slot, CAREER); goToMainMenu(); };
  document.getElementById('btn-continue-career').onclick = () => {
    document.getElementById('fulltime-overlay').classList.add('hidden');
    showCareerDashboard(); // also pops the season-complete overlay itself, if that match ended the season
  };
  document.getElementById('btn-season-complete-continue').onclick = () => {
    document.getElementById('season-complete-overlay').classList.add('hidden');
  };

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
  document.getElementById('btn-season-view-fixtures').onclick = () => toggleSeasonView('fixtures');
  document.getElementById('btn-season-view-table').onclick = () => toggleSeasonView('table');
  document.getElementById('btn-continue-season').onclick = () => {
    document.getElementById('fulltime-overlay').classList.add('hidden');
    renderSeasonTable();
    showScreen('season-table-screen');
  };

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
    if (CUP.won && !CUP.trophyShown) {
      CUP.trophyShown = true;
      showCupTrophyMoment();
      return;
    }
    renderCupProgress();
    showScreen('cup-progress-screen');
  };
  document.getElementById('btn-cup-trophy-continue').onclick = () => {
    document.getElementById('cup-trophy-overlay').classList.add('hidden');
    renderCupProgress();
    showScreen('cup-progress-screen');
  };
  document.getElementById('btn-shootout-kick').addEventListener('pointerdown', (e) => { e.preventDefault(); startShootoutCharge(); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(evt => {
    document.getElementById('btn-shootout-kick').addEventListener(evt, (e) => { e.preventDefault(); releaseShootoutCharge(); });
  });


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

  // Subs is a full page (like the Career squad screen) rather than a small
  // popup now, with its own 15s auto-return timer - see
  // startSubsAutoTimer/closeSubsScreen. returnTarget records which overlay
  // (pause or halftime) sent us here, so Back/timeout can put it back.
  const openSubs = (returnTarget) => {
    pendingSubOut = null;
    renderSubsScreen();
    document.getElementById(returnTarget === 'halftime' ? 'halftime-overlay' : 'pause-overlay').classList.add('hidden');
    if (returnTarget === 'halftime' && G.halftimeInterval) { clearInterval(G.halftimeInterval); G.halftimeInterval = null; }
    showScreen('subs-screen');
    startSubsAutoTimer(returnTarget);
  };
  document.getElementById('btn-subs').onclick = () => openSubs('pause');
  document.getElementById('btn-subs-halftime').onclick = () => openSubs('halftime');
  document.getElementById('btn-subs-close').onclick = () => closeSubsScreen(false);
  // Sub Off/Bring On are wired directly per-card inside formatMatchPlayerRow
  // now (same convention as the Career squad screens), not via a delegated
  // click listener here.

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
  document.getElementById('btn-online-rematch').onclick = requestOnlineRematch;
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
    G.shootDragMag = 0;
    const knob = document.getElementById('td-shoot-knob');
    if (knob) knob.style.transform = 'translate(0px, 0px)';
    const shootBtn = document.getElementById('td-shoot');
    if (shootBtn) shootBtn.classList.remove('aiming');
    pauseGame();
  });
  // Covers phone app-switching / screen lock, which doesn't always fire 'blur'.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseGame();
  });

  // Mode-browser navigation - deliberately its own listener rather than
  // folded into the match keydown handler above: arrow keys/Enter/Space
  // only matter while sat on the main menu itself, never mid-match. Also
  // guarded on the main-menu screen actually being the visible one - G.state
  // stays STATE.MENU while browsing any career/setup screen too (nothing
  // else changes it along that path), so without this it would also nudge
  // the (hidden) hub carousel underneath whatever screen you're really on.
  window.addEventListener('keydown', (e) => {
    if (G.state !== STATE.MENU || isTypingIntoField()) return;
    if (document.getElementById('main-menu').classList.contains('hidden')) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); goToModePage(modeBrowserIdx - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); goToModePage(modeBrowserIdx + 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectModePage(); }
  });

  // Difficulty picker arrow-key browsing - see armRankPicker, armed by
  // clicking any rank tile on whichever setup screen you're on.
  window.addEventListener('keydown', (e) => {
    if (!activeRankPicker || isTypingIntoField()) return;
    if (document.getElementById(activeRankPicker.screenId).classList.contains('hidden')) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const { setupObj, render } = activeRankPicker;
    const curIdx = Math.max(0, RANK_SKILLS.indexOf(setupObj.skillKey));
    const dir = e.key === 'ArrowLeft' ? -1 : 1;
    setupObj.skillKey = RANK_SKILLS[(curIdx + dir + RANK_SKILLS.length) % RANK_SKILLS.length];
    render();
  });

  // Transfer Market navigation - same arrow-key idea as the hub above, this
  // time on career-transfer-screen's own three carousels (see marketNav).
  window.addEventListener('keydown', (e) => {
    if (isTypingIntoField() || careerMarketTab !== 'buy') return;
    if (document.getElementById('career-transfer-screen').classList.contains('hidden')) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Enter') return;
    e.preventDefault();
    if (marketNav.level === 'league') {
      if (e.key === 'ArrowLeft') goToMarketLeague(marketNav.leagueIdx - 1);
      else if (e.key === 'ArrowRight') goToMarketLeague(marketNav.leagueIdx + 1);
      else enterMarketLeague(marketNav.leagueIdx);
    } else if (marketNav.level === 'club') {
      if (e.key === 'ArrowLeft') goToMarketClub(marketNav.clubIdx - 1);
      else if (e.key === 'ArrowRight') goToMarketClub(marketNav.clubIdx + 1);
      else enterMarketClub(marketNav.clubIdx);
    } else if (marketNav.level === 'position') {
      if (e.key === 'ArrowLeft') goToMarketPosition(marketNav.posIdx - 1);
      else if (e.key === 'ArrowRight') goToMarketPosition(marketNav.posIdx + 1);
      // Enter has no action here - Sign is its own button per player card.
    }
  });

  setupCanvasDPI();
  window.addEventListener('resize', setupCanvasDPI);
  window.addEventListener('orientationchange', setupCanvasDPI);

  setupTouchControls();
  initModeBrowser();
  // Same abstract flowing-line backdrop as the main hub (see
  // renderModeAbstractLines), extended to each mode's own setup screen so
  // it doesn't feel like a completely different, plainer app once you
  // actually pick a mode - these are static single screens (not a
  // carousel), so this only ever needs to run once.
  ['setup-screen', 'season-setup-screen', 'cup-setup-screen', 'career-club-screen', 'online-menu-screen', 'subs-screen', 'settings-screen', 'stats-screen'].forEach(id => {
    const screen = document.getElementById(id);
    if (screen) renderModeAbstractLines(screen.querySelector('.mode-abstract-bg'));
  });
  // Same treatment for the pause/halftime/fulltime overlays (see .pause-box)
  // - none of these are .screen elements above (they're overlays), so each
  // needs its own call.
  ['#pause-overlay', '#halftime-overlay', '#fulltime-overlay'].forEach(sel => {
    renderModeAbstractLines(document.querySelector(`${sel} .mode-abstract-bg`));
  });
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

// The Shoot button doubles as a small drag joystick, same footprint as the
// button itself (see the CSS #td-shoot/#td-shoot-knob) - dragging it aims
// the shot exactly where dragged (fed to releaseShot as a world-space
// direction via resolveShootAim/G.shootAimVec), a plain tap with no real
// drag still just fires an ordinary shot via the existing auto-target. The
// knob's own travel is clamped to knobMaxR regardless of how far the
// finger actually strays (same "clamp then normalize" approach as
// setupJoystick's movement stick), so the drag can go anywhere on screen.
function bindShootJoystick(id) {
  const el = document.getElementById(id);
  const knob = document.getElementById('td-shoot-knob');
  const knobMaxR = 22; // px
  let activePointerId = null;

  function setFromClient(clientX, clientY) {
    const rect = el.getBoundingClientRect();
    const dx = clientX - (rect.left + rect.width / 2);
    const dy = clientY - (rect.top + rect.height / 2);
    const d = Math.min(Math.hypot(dx, dy), knobMaxR);
    const angle = Math.atan2(dy, dx);
    knob.style.transform = `translate(${Math.cos(angle) * d}px, ${Math.sin(angle) * d}px)`;
    G.shootDragMag = d / knobMaxR;
    if (G.shootDragMag > 0.02) { G.shootAimVec.x = Math.cos(angle); G.shootAimVec.y = Math.sin(angle); }
    el.classList.toggle('aiming', G.shootDragMag > SHOOT_DRAG_THRESHOLD);
  }

  function reset() {
    knob.style.transform = 'translate(0px, 0px)';
    G.shootDragMag = 0;
    el.classList.remove('aiming');
    activePointerId = null;
  }

  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    activePointerId = e.pointerId;
    el.setPointerCapture(e.pointerId);
    if (!G.charge.shoot) { G.charge.shoot = true; G.charge.shootStart = performance.now(); }
    setFromClient(e.clientX, e.clientY);
  });
  el.addEventListener('pointermove', (e) => {
    if (e.pointerId !== activePointerId) return;
    e.preventDefault();
    setFromClient(e.clientX, e.clientY);
  });
  const release = (e) => {
    if (e.pointerId !== activePointerId) return;
    e.preventDefault();
    if (G.charge.shoot) onChargeRelease('shoot'); // reads G.shootDragMag/shootAimVec - must run before reset() clears them
    reset();
  };
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
  bindShootJoystick('td-shoot');
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
// STUN alone only lets two peers discover their own public IP/port - it
// can't establish a connection at all when either side is behind a
// symmetric/carrier-grade NAT (very common on mobile data, and plenty of
// home/school/office WiFi), since neither side ever ends up with an address
// the other can actually reach. TURN relays the connection through a third
// party for exactly that case. Openrelay's free public TURN (Metered.ca) -
// fine for a small hobby game's occasional online match; it's rate-limited
// and not guaranteed uptime, so if online still won't connect for someone,
// a paid TURN provider (Twilio, Xirsys, Metered's own paid tier) would be
// the next step up.
const ONLINE_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
];
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
// How long a mid-match reconnect attempt gets before giving up and showing
// the permanent "connection lost" overlay - the relay itself will hold the
// room open far longer than this (see ROOM_IDLE_TTL_MS server-side), but
// there's no point leaving the player staring at "Reconnecting..." forever
// if their friend genuinely isn't coming back.
const RECONNECT_TIMEOUT_MS = 25000;

function setOnlineHostStatus(text) {
  const el = document.getElementById('online-host-status');
  if (el) el.textContent = text;
}
function setOnlineJoinStatus(text) {
  const el = document.getElementById('online-join-status');
  if (el) el.textContent = text;
}
function setOnlineQuickmatchStatus(text) {
  const el = document.getElementById('online-quickmatch-status');
  if (el) el.textContent = text;
}
function setOnlineReconnectStatus(text) {
  const el = document.getElementById('online-reconnect-status');
  if (el) el.textContent = text;
}
function showReconnectingOverlay() {
  if (G.state === STATE.MENU) return;
  document.getElementById('online-reconnecting-overlay').classList.remove('hidden');
}
function hideReconnectingOverlay() {
  document.getElementById('online-reconnecting-overlay').classList.add('hidden');
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
  hideReconnectingOverlay(); // in case a deliberate quit happens mid-reconnect-attempt
}

// Shown once a mid-match connection loss has been given up on entirely
// (see attemptOnlineReconnect - this is the fallback once that fails or
// times out, not the first thing shown). Not shown for a deliberate local
// quit, since teardownOnline() (called by goToMainMenu) already nulls
// G.online synchronously before any of the triggers that lead here ever
// get a chance to fire.
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
      if (G.online.matchStarted) {
        // Already mid-match - worth trying to recover the connection rather
        // than immediately ending the game (see attemptOnlineReconnect).
        attemptOnlineReconnect();
      } else {
        const msg = "Connection failed - this can happen with strict/symmetric NAT or firewalls. If it keeps failing, try having one of you switch to a mobile hotspot.";
        if (G.online.role === 'host') setOnlineHostStatus(msg); else setOnlineJoinStatus(msg);
      }
    }
  };
}

function sendOnlineMessage(msg) {
  if (!G.online || !G.online.dc || G.online.dc.readyState !== 'open') return;
  G.online.dc.send(JSON.stringify(msg));
}

// The 'ping'/'ping-ack' pair (logged to console) just proves the channel
// actually works end to end; real match messages are dispatched to
// hostHandleMessage/guestHandleMessage below. isReconnect (set by
// attemptOnlineReconnect when re-establishing a dropped mid-match
// connection) skips the normal first-time-connected UI - the players are
// already deep inside a match, not sat on the team-pick screen.
function wireOnlineDataChannel(dc, isReconnect) {
  dc.onopen = () => {
    if (!G.online) return;
    G.online.connState = 'open';
    console.log('[online] data channel open, role=' + G.online.role + (isReconnect ? ' (reconnect)' : ''));
    // The relay's only job was introducing the two peers - now that the
    // real, direct DataChannel is open, it's no longer needed. Tell it so
    // first (marks the room reconnect-eligible server-side - see
    // relay-server/server.js), then close.
    sendSignal({ type: 'connected' });
    try { G.online.signalWs && G.online.signalWs.close(); } catch (e) { /* already closed */ }
    G.online.signalWs = null;
    if (isReconnect) {
      G.online.reconnecting = false;
      hideReconnectingOverlay();
      return;
    }
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
    if (G.online.matchStarted) attemptOnlineReconnect();
    else showConnectionLostOverlay();
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
  } else if (msg.type === 'rematchRequest') {
    requestOnlineRematch(); // guest asked for a rematch - only the host can actually start one, see requestOnlineRematch's role branch
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
    document.getElementById('btn-online-rematch').classList.remove('hidden');
    document.getElementById('btn-online-rematch').disabled = false;
    document.getElementById('online-rematch-status').classList.add('hidden');
    document.getElementById('btn-continue-season').classList.add('hidden');
    document.getElementById('btn-continue-cup').classList.add('hidden');
    document.getElementById('btn-continue-career').classList.add('hidden');
    // Guest is always G.teams[1] (host is always team 0 - see
    // startOnlineHostedMatch), opposite convention from the host's own
    // recordOnlineResult call in finalizeFulltime.
    recordOnlineResult(G.teams[1].score, G.teams[0].score);
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
  const aimable = (G.charge.shoot && isAimableShotSituation(G.controlled)) || (G.charge.pass && isAimableThrowinSituation(G.controlled));
  if (!G.controlled || !aimable) return;
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
  styleTeamBox(box, def);
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

// Real rematch against the still-connected friend (the DataChannel stays
// open right through the fulltime screen - teardownOnline is only ever
// called by actually leaving), not a fresh room-code handshake - same two
// clubs replayed again. Only the host can actually restart the match (same
// "team 0 = host" assumption as everywhere else in this codebase), so a
// guest clicking this just asks the host to do it instead (see
// hostHandleMessage's 'rematchRequest' branch, which calls straight back
// into this same function on the host's own client).
function requestOnlineRematch() {
  if (!G.online) return;
  if (G.fulltimeTimeout) { clearTimeout(G.fulltimeTimeout); G.fulltimeTimeout = null; }
  document.getElementById('btn-online-rematch').disabled = true;
  if (G.online.role === 'host') {
    document.getElementById('fulltime-overlay').classList.add('hidden');
    startOnlineHostedMatch(onlineTeamPickList()[onlineTeamPick.clubIdx], onlineRemoteTeamDef, onlineRemoteLineup);
  } else {
    const statusEl = document.getElementById('online-rematch-status');
    statusEl.textContent = "Rematch requested - waiting for your friend...";
    statusEl.classList.remove('hidden');
    sendOnlineMessage({ type: 'rematchRequest' });
  }
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
  G.online = { role: 'host', pc, dc, signalWs: null, roomCode: null, reconnecting: false, connState: 'connecting', matchStarted: false, snapshotBuf: [null, null], lastBroadcastAt: 0 };
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
  G.online = { role: 'guest', pc: null, dc: null, signalWs: null, roomCode: code, reconnecting: false, connState: 'connecting', matchStarted: false, snapshotBuf: [null, null], lastBroadcastAt: 0 };
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
          const localDesc = await createGuestAnswer(pc, msg.payload.sdp);
          sendSignal({ type: 'relay', payload: { sdp: localDesc } });
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

// Shared by the guest's initial join (above) and both sides' reconnect flow
// (attemptOnlineReconnect below) - answers a received offer and returns the
// finished local description, ready to relay back.
async function createGuestAnswer(pc, remoteSdp) {
  await pc.setRemoteDescription(remoteSdp);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await waitForIceGatheringComplete(pc);
  return pc.localDescription;
}

// No code to share/type - the relay's quickQueue (see server.js) pairs this
// socket with whoever else is waiting, or parks it in line until someone
// is. Once paired, the relay hands back a real room code (asHost decides
// which side offers vs answers) and everything downstream - the SDP
// handshake, 'connected', a later reconnect - works identically to a
// manual host/join pairing.
function startQuickMatch() {
  teardownOnline();
  G.online = { role: null, pc: null, dc: null, signalWs: null, roomCode: null, reconnecting: false, connState: 'connecting', matchStarted: false, snapshotBuf: [null, null], lastBroadcastAt: 0 };
  setOnlineQuickmatchStatus('Connecting to the server... can take up to a minute if it was asleep.');
  G.online.signalWs = openSignalingSocket({
    onOpen: () => sendSignal({ type: 'quickMatch' }),
    onMessage: async (msg) => {
      if (!G.online) return;
      if (msg.type === 'queued') {
        setOnlineQuickmatchStatus('Searching for an opponent...');
      } else if (msg.type === 'quickMatched') {
        G.online.role = msg.asHost ? 'host' : 'guest';
        G.online.roomCode = msg.code;
        setOnlineQuickmatchStatus('Found an opponent - connecting...');
        if (msg.asHost) {
          try {
            const pc = new RTCPeerConnection({ iceServers: ONLINE_ICE_SERVERS });
            const dc = pc.createDataChannel('match');
            G.online.pc = pc;
            G.online.dc = dc;
            wireOnlineDataChannel(dc);
            wireOnlinePeerConnection(pc);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            await waitForIceGatheringComplete(pc);
            sendSignal({ type: 'relay', payload: { sdp: pc.localDescription } });
          } catch (e) {
            setOnlineQuickmatchStatus("Couldn't finish connecting - check your network and try again.");
          }
        }
        // the guest side just waits for the 'relay' offer below, same as joinOnlineWithCode
      } else if (msg.type === 'relay') {
        try {
          if (G.online.role === 'host') {
            await G.online.pc.setRemoteDescription(msg.payload.sdp);
            setOnlineQuickmatchStatus('Connecting...');
          } else {
            const pc = new RTCPeerConnection({ iceServers: ONLINE_ICE_SERVERS });
            G.online.pc = pc;
            pc.ondatachannel = (e) => { G.online.dc = e.channel; wireOnlineDataChannel(e.channel); };
            wireOnlinePeerConnection(pc);
            const localDesc = await createGuestAnswer(pc, msg.payload.sdp);
            sendSignal({ type: 'relay', payload: { sdp: localDesc } });
            setOnlineQuickmatchStatus('Connecting...');
          }
        } catch (e) {
          setOnlineQuickmatchStatus("Couldn't finish connecting - check your network and try again.");
        }
      }
    },
    onClose: () => { /* either the DataChannel already took over, or we cancelled/left the queue - nothing to do */ },
    onTimeout: () => setOnlineQuickmatchStatus("Couldn't reach the server - check your connection and try again."),
  });
}

// A dropped mid-match connection (see wireOnlinePeerConnection/
// wireOnlineDataChannel) doesn't have to be the end of the game - both
// sides still remember the same room code, and the relay keeps a paired
// room reachable for reconnects (see relay-server/server.js's 'rejoin'
// handling) well past any reasonable retry window. This re-does the whole
// WebRTC offer/answer handshake from scratch against that same code; once
// the new DataChannel opens, wireOnlineDataChannel's isReconnect path just
// quietly resumes play - snapshots/inputs pick back up on their own since
// the host's broadcast loop and the guest's message handling never
// stopped, they just had nothing to send/receive for a bit.
function attemptOnlineReconnect() {
  if (!G.online || !G.online.roomCode) { showConnectionLostOverlay(); return; }
  if (G.online.reconnecting) return; // already retrying - this is a second failure event for the same drop
  G.online.reconnecting = true;
  showReconnectingOverlay();
  setOnlineReconnectStatus('Connection dropped - reconnecting...');
  try { G.online.pc && G.online.pc.close(); } catch (e) { /* already closed */ }
  try { G.online.dc && G.online.dc.close(); } catch (e) { /* already closed */ }
  try { G.online.signalWs && G.online.signalWs.close(); } catch (e) { /* already closed */ }
  G.online.pc = null;
  G.online.dc = null;
  G.online.signalWs = null;
  const role = G.online.role;
  const code = G.online.roomCode;

  // wireOnlineDataChannel's isReconnect path clears G.online.reconnecting
  // once the new dc actually opens - giveUp() no-ops if that already
  // happened by the time this fires, so there's no need to explicitly
  // cancel the timer on success, just let it check the flag.
  const giveUp = () => {
    if (!G.online || !G.online.reconnecting) return;
    G.online.reconnecting = false;
    hideReconnectingOverlay();
    showConnectionLostOverlay();
  };
  const failTimer = setTimeout(giveUp, RECONNECT_TIMEOUT_MS);

  G.online.signalWs = openSignalingSocket({
    onOpen: () => sendSignal({ type: 'rejoin', code, asHost: role === 'host' }),
    onMessage: async (msg) => {
      if (!G.online || !G.online.reconnecting) return;
      if (msg.type === 'not-found') { clearTimeout(failTimer); giveUp(); return; }
      if (msg.type === 'rejoined') {
        setOnlineReconnectStatus('Found your friend again - reconnecting...');
        if (role === 'host') {
          try {
            const pc = new RTCPeerConnection({ iceServers: ONLINE_ICE_SERVERS });
            const dc = pc.createDataChannel('match');
            G.online.pc = pc;
            G.online.dc = dc;
            wireOnlineDataChannel(dc, true);
            wireOnlinePeerConnection(pc);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            await waitForIceGatheringComplete(pc);
            sendSignal({ type: 'relay', payload: { sdp: pc.localDescription } });
          } catch (e) { clearTimeout(failTimer); giveUp(); }
        }
        // the guest side just waits for the 'relay' offer below
      } else if (msg.type === 'relay') {
        try {
          if (role === 'host') {
            await G.online.pc.setRemoteDescription(msg.payload.sdp);
          } else {
            const pc = new RTCPeerConnection({ iceServers: ONLINE_ICE_SERVERS });
            G.online.pc = pc;
            pc.ondatachannel = (e) => { G.online.dc = e.channel; wireOnlineDataChannel(e.channel, true); };
            wireOnlinePeerConnection(pc);
            const localDesc = await createGuestAnswer(pc, msg.payload.sdp);
            sendSignal({ type: 'relay', payload: { sdp: localDesc } });
          }
        } catch (e) { clearTimeout(failTimer); giveUp(); }
      }
    },
    onClose: () => { /* the new DataChannel takes over from here if it opened in time; giveUp's timer covers the case where it didn't */ },
    onTimeout: () => { clearTimeout(failTimer); giveUp(); },
  });
}
