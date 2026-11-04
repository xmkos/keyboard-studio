export function buildSleep(current,settings) {
  if (!Array.isArray(current) || current.length!==8 || !current.every(v=>Number.isInteger(v)&&v>=0&&v<=255)) throw new Error('Параметри сну не зчитано.');
  if (!settings || !Number.isInteger(settings.bt) || !Number.isInteger(settings.wired) || settings.bt<0 || settings.bt>1080 || settings.wired<0 || settings.wired>1080) throw new Error('Час сну має бути 0–1080 хвилин.');
  return [settings.bt&255,settings.bt>>8,settings.wired&255,settings.wired>>8,...current.slice(4)];
}
