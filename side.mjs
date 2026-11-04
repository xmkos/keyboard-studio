export function buildSide(current, settings){
 if(!Array.isArray(current)||current.length!==7||!current.every(v=>Number.isInteger(v)&&v>=0&&v<=255))throw new Error('Бокове RGB не зчитано.');
 if(!settings||![0,1,2,3,4].includes(settings.effect)||!Number.isInteger(settings.brightness)||settings.brightness<0||settings.brightness>4||!Number.isInteger(settings.speed)||settings.speed<0||settings.speed>({0:0,1:0,2:3,3:3,4:4}[settings.effect])||typeof settings.dazzle!=='boolean'||!Number.isInteger(settings.rgb)||settings.rgb<0||settings.rgb>0xffffff)throw new Error('Некоректні параметри бокового RGB.');
 const rgb=settings.rgb===0xffffff?0xfafffa:settings.rgb;
 return [8,settings.effect,settings.speed,settings.brightness,settings.effect===3?8:(settings.dazzle?8:7),(rgb>>16)&255,(rgb>>8)&255,rgb&255];
}
