export const TITLE_HEIGHT = 24;
export function mapPoint(clientX,clientY,box,width,height){
 const scale=Math.min(box.width/width,box.height/height);
 const left=box.left+(box.width-width*scale)/2,top=box.top+(box.height-height*scale)/2;
 return {x:Math.max(0,Math.min(width-1,(clientX-left)/scale)),y:Math.max(0,Math.min(height-1,(clientY-top)/scale))};
}
export function clampBounds(b, availableWidth, availableHeight) {
 const width=Math.min(availableWidth-4,Math.max(320,Math.round(b.width)));
 const height=Math.min(availableHeight-TITLE_HEIGHT,Math.max(180,Math.round(b.height)));
 return {x:Math.max(0,Math.min(Math.round(b.x),availableWidth-width-4)),y:Math.max(0,Math.min(Math.round(b.y),availableHeight-height-TITLE_HEIGHT)),width,height};
}
