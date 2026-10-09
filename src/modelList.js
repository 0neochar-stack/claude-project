// The downloaded models the game uses, by key. Paths are relative to models/ (copied into dist/models by the
// build). Plain data with no imports, so the build script can read it too.
export const MODEL_FILES = {
  // nature
  trees: 'nature/trees.glb',
  rockA: 'nature/rocks_a.glb',
  rockB: 'nature/rocks_b.glb',
  maple: 'nature/bush.glb',
  bushes: 'nature/bushes.glb',
  // animals
  deer: 'animals/deer.glb',
  stag: 'animals/stag.glb',
  cow: 'animals/cow.glb',
  bull: 'animals/bull.glb',
  wolf: 'animals/wolf.glb',
  // buildings
  barn: 'buildings/barn.glb',
  silo: 'buildings/silo_house.glb',
  farmhouse: 'buildings/farm_house.glb',
  pagoda: 'japan/pagoda_a.glb',
  pagodaB: 'japan/pagoda_b.glb',
  torii: 'japan/torii.glb',
  // street props
  hydrant: 'props/hydrant_b.glb',
  mailbox: 'props/mailbox_b.glb',
  usps: 'props/mailbox_a.glb',
  busStop: 'props/bus_stop_sign.glb',
  trafficLight: 'props/traffic_light_a.glb',
  stopSign: 'props/stop_sign.glb',
  dumpster: 'props/dumpster_b.glb',
  dumpsterB: 'props/dumpster_a.glb',
  trashBag: 'props/trash_bag.glb',
  crate: 'props/crate.glb',
  box: 'props/box.glb',
  atm: 'props/atm.glb',
  vending: 'props/vending_b.glb',
  gasTank: 'props/gas_tank.glb',
  roadBarrier: 'props/traffic_barrier.glb',
  fence: 'props/fence.glb',
  cup: 'props/soda.glb',
  can: 'props/soda_can.glb',
  bottle: 'props/bottle.glb',
};

// The animal animations the game plays; the rest are left out of the build.
export const ANIMAL_CLIPS = ['Idle', 'Idle_2', 'Idle_Headlow', 'Idle_2_HeadLow', 'Eating', 'Walk', 'Gallop'];

// Who made what, for the credits screen. CC0 models need no credit but get one anyway.
export const MODEL_CREDITS = [
  ['Trees, rocks, bushes, deer, stag, cow, bull, wolf, silo, traffic light, road barrier, gas tank, crate, soda cup, bottle, barn', 'Quaternius (CC0)'],
  ['Box', 'Kay Lousberg (CC0)'],
  ['Soda can', 'Kenney (CC0)'],
  ['Farm house, pagoda, curbside mailbox, fire hydrant, stop sign', 'Poly by Google (CC-BY)'],
  ['Pagoda (three-tier)', 'Poly by Google (CC-BY)'],
  ['Japanese torii', 'Jacques Fourie (CC-BY)'],
  ['Blue mailbox, ATM', 'J-Toastie (CC-BY)'],
  ['Vending machine, bus stop sign', 'dook (CC-BY)'],
  ['Dumpster', 'KolosStudios (CC-BY)'],
  ['Dumpster (green)', 'Jarlan Perez (CC-BY)'],
  ['Trash bag', 'Jens Kull (CC-BY)'],
];
