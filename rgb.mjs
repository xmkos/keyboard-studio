import {MATRIX} from './protocol.mjs';

const LIGHT_LIST = Object.freeze({
  LightOff: 0, LightAlwaysOn: 1, LightBreath: 2, LightNeon: 3, LightWave: 4,
  LightRipple: 5, LightRaindrop: 6, LightSnake: 7, LightPressAction: 8,
  LightConverage: 9, LightSineWave: 10, LightKaleidoscope: 11,
  LightLineWave: 12, LightUserPicture: 13, LightLaser: 14,
  LightCircleWave: 15, LightDazzing: 16, LightRainDown: 17,
  LightMeteor: 18, LightPressActionOff: 19, LightMusicFollow3: 20,
  LightScreenColor: 21, LightMusicFollow2: 22, LightTrain: 23,
  LightFireWorks: 24, LightUserColor: 66,
});

const rgba = (type, options = []) => ({type, id: LIGHT_LIST[type], maxBrightness: 4, maxSpeed: 4, rgb: true, dazzle: true, options});
export const RT80_LIGHT_EFFECTS = Object.freeze([
  rgba('LightWave', ['right', 'left', 'down', 'up']),
  rgba('LightRipple'), rgba('LightRaindrop'), rgba('LightSnake', ['z', 'loop']),
  rgba('LightPressAction'), rgba('LightConverage'), rgba('LightSineWave'),
  rgba('LightKaleidoscope', ['out', 'in']), rgba('LightPressActionOff'),
  rgba('LightLineWave', ['right', 'left']), rgba('LightLaser'),
  rgba('LightCircleWave', ['counterclockwise', 'clockwise']),
  rgba('LightDazzing'), rgba('LightRainDown'), rgba('LightMeteor'),
  {type:'LightAlwaysOn', id:1, maxBrightness:4, maxSpeed:0, rgb:true, dazzle:true, options:[]},
  rgba('LightBreath'),
  {type:'LightNeon', id:3, maxBrightness:4, maxSpeed:0, rgb:false, dazzle:false, options:[]},
  {type:'LightUserPicture', id:13, maxBrightness:4, maxSpeed:0, rgb:false, dazzle:false, options:['pattern1','pattern2','pattern3']},
  rgba('LightMusicFollow2', ['upright', 'separate', 'intersect']),
  {type:'LightScreenColor', id:21, maxBrightness:4, maxSpeed:0, rgb:false, dazzle:false, options:[]},
]);

const byType = new Map(RT80_LIGHT_EFFECTS.map(effect => [effect.type, effect]));
const byId = new Map(RT80_LIGHT_EFFECTS.map(effect => [effect.id, effect]));
const COMMON_COLORS = [0xff0000, 0xff8000, 0xffff00, 0x00ff00, 0x00ffff, 0x0000ff, 0xff00ff];
const WHITE_WIRE_VALUE = 0xfafffa;
const MATRIX_POSITIONS = 90;

function uint8(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 255) throw new RangeError(`${label} must be a byte`);
  return value;
}

function checkedColor(rgb) {
  if (!Number.isInteger(rgb) || rgb < 0 || rgb > 0xffffff) throw new RangeError('rgb must be a 24-bit integer');
  return rgb === 0xffffff ? WHITE_WIRE_VALUE : rgb;
}

function modeByte(setting, effect) {
  const option = setting.option ?? 0;
  if (!Number.isInteger(option) || option < 0 || option >= Math.max(1, effect.options.length)) throw new RangeError('invalid effect option');
  if (effect.type === 'LightScreenColor') return 0;
  if (effect.type === 'LightNeon') return 8;
  if (effect.type === 'LightUserPicture') return option << 4;
  if (effect.type === 'LightMusicFollow2') return (option << 4) | (setting.dazzle ? 0 : 4);
  return (option << 4) | (setting.dazzle ? 8 : 7);
}

export function encodeMainLightSetting(setting) {
  if (!setting || !byType.has(setting.type)) throw new Error('unsupported RT80 light effect');
  if (setting.dazzle !== undefined && typeof setting.dazzle !== 'boolean') throw new TypeError('dazzle must be boolean');
  const effect = byType.get(setting.type);
  const brightness = uint8(setting.bright, 'brightness');
  const speed = uint8(setting.speed ?? 0, 'speed');
  if (brightness > effect.maxBrightness || speed > effect.maxSpeed) throw new RangeError('light value exceeds the RT80 UI range');
  const data = new Uint8Array(64);
  data.set([7, effect.id, 4 - speed, brightness, modeByte(setting, effect)]);
  if (effect.type === 'LightUserPicture') data.set([0, 200, 200], 5);
  else if (effect.rgb && setting.rgb !== undefined) {
    const rgb = checkedColor(setting.rgb);
    data.set([rgb >>> 16, (rgb >>> 8) & 255, rgb & 255], 5);
  }
  return data;
}

export function mainLightReadRequest() {
  const data = new Uint8Array(64);
  data[0] = 135;
  return data;
}

export function decodeMainLightSetting(reply) {
  if (!(reply instanceof Uint8Array) || reply.length < 8) throw new TypeError('expected an 8-byte-or-longer light response');
  const effect = byId.get(reply[1]);
  if (!effect) return undefined;
  const mode = reply[4] & 15;
  let rgb = (reply[5] << 16) | (reply[6] << 8) | reply[7];
  if (effect.type !== 'LightMusicFollow2' && effect.type !== 'LightScreenColor' && mode !== 7 && mode !== 8 && COMMON_COLORS[mode] !== undefined) rgb = COMMON_COLORS[mode];
  if (rgb === WHITE_WIRE_VALUE) rgb = 0xffffff;
  return {
    type: effect.type,
    speed: 4 - reply[2],
    bright: reply[3],
    option: reply[4] >>> 4,
    rgb,
    dazzle: effect.type === 'LightMusicFollow2' ? mode === 0 : mode === 8,
  };
}

export function encodeCustomPicture(picArr) {
  if (!Array.isArray(picArr)) throw new TypeError('picArr must be an array');
  const pixels = new Uint8Array(MATRIX_POSITIONS * 3);
  const seen = new Set();
  for (const pixel of picArr) {
    const pos = MATRIX.indexOf(pixel?.hid);
    if (!pixel?.hid || !Number.isInteger(pos) || pos < 0 || pos >= MATRIX_POSITIONS || pixel.index !== undefined && pixel.index !== 0 || seen.has(pos)) throw new Error('invalid or duplicate RT80 picture key');
    seen.add(pos);
    const rgb = checkedColor(pixel.rgb);
    pixels.set([rgb >>> 16, (rgb >>> 8) & 255, rgb & 255], pos * 3);
  }
  const frames = [];
  for (let page = 0; page < 7; page++) {
    const frame = new Uint8Array(64);
    frame.set([12, 0, 0, 1, page]); // GearHub sends a 256-byte length field and seven fixed 56-byte pages.
    frame.set(pixels.slice(page * 56, page * 56 + 56), 8);
    frames.push(frame);
  }
  return frames;
}

export function customPictureReadRequests() {
  return Array.from({length: 6}, (_, page) => Uint8Array.of(140, 0, page));
}

export function decodeCustomPicture(readPages) {
  if (!Array.isArray(readPages) || readPages.length !== 6 || readPages.some(page => !(page instanceof Uint8Array) || page.length !== 64)) throw new TypeError('expected six 64-byte picture pages');
  const pixels = Uint8Array.from(readPages.flatMap(page => [...page]));
  const result = [];
  const seen = new Map();
  for (let pos = 0; pos < MATRIX_POSITIONS; pos++) {
    const hid = MATRIX[pos];
    if (!hid) continue;
    const rgb = (pixels[pos * 3] << 16) | (pixels[pos * 3 + 1] << 8) | pixels[pos * 3 + 2];
    const index = seen.get(hid) ?? 0;
    result.push({hid, index, rgb});
    seen.set(hid, index + 1);
  }
  return result;
}
