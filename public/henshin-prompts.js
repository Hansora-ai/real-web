/* The editor and server share the same defaults for an empty extra prompt. */
(function(root){
 const preserve='Preserve the source video’s exact camera angles, camera movement, framing, shot sequence, timing, actions, lighting and background. Do not introduce cuts, zooms, extra subjects or identity drift.';
 const defaults={
  motion:'Replace the main character using the reference images. Match every original movement, expression, pose, timing and rhythm. Use the images for identity and appearance, never their camera angle or pose. '+preserve,
  swap:'Replace the primary object in the source video that matches the object category shown in the reference images. Use all reference views for the same replacement object. Match its original position, scale, perspective, motion, contact, shadows and occlusions. Leave other people and objects unchanged. '+preserve,
  edit:'Edit the main subject or object in the source video using the identity, appearance, clothing and visual details shown in the reference images. Apply those details only to the corresponding subject or object, consistently throughout the clip. Keep unrelated people, objects and scene elements unchanged. '+preserve
 };
 if(typeof module==='object'&&module.exports)module.exports=defaults;else root.HenshinPrompts=defaults;
})(typeof window==='object'?window:globalThis);
