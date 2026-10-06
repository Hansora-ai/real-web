/* Built-in Henshin instructions. Server-only: never serve this file or store the built
  prompt where users can read it. The user's prompt is added last and has priority. */
'use strict';
const strict=[
 'Strictly keep these exactly as in @Video 1: camera angle, camera position, camera movement, framing, zoom, shot sequence, cuts, duration and timing; every movement, pose, gesture, dance step, facial expression, lip movement and eye direction; where each person is in the frame and how big they are; the background and lighting.',
 'Do not add new camera angles, cuts, zooms, reframing, people or effects.'
].join('\n');
const consistency='Keep every replaced character or object consistent in every frame, including turns, fast motion and when partly hidden. No flicker, morphing or identity drift.';
const modes={
 motion:tags=>[
  `Replace the main character or characters in @Video 1 with the character or characters shown in ${tags}.`,
  'Take their look from the images: face, hair, skin, body, clothing and accessories. Work out from the images how many characters there are and which person in the video each one replaces.',
  'Ignore the pose, camera angle and background of the reference images.'
 ].join('\n'),
 swap:tags=>[
  `Replace the main object or objects in @Video 1 with the object or objects shown in ${tags}.`,
  'Work out from the images which objects they are and which object in the video each one replaces. Copy their shape, colors, materials and details.',
  "Each new object takes the original object's place, size, perspective and movement, including how it is held or touched."
 ].join('\n'),
 edit:tags=>tags?[
  `Edit the main subject or subjects in @Video 1 using ${tags}.`,
  'Apply the appearance, clothing, colors, materials and style from the images to the matching subjects in the video.'
 ].join('\n'):"Edit @Video 1 according to the user's prompt. If no change is requested, preserve the original subjects and scene."
};
// Defaults the editors pre-filled into the prompt box before this change; they mean "no extra request".
const legacyTail=' Preserve the source video’s exact camera angles, camera movement, framing, shot sequence, timing, actions, lighting and background. Do not introduce cuts, zooms, extra subjects or identity drift.';
const legacy=[
 'Replace the main character using the reference images. Match every original movement, expression, pose, timing and rhythm. Use the images for identity and appearance, never their camera angle or pose.'+legacyTail,
 'Replace the primary object in the source video that matches the object category shown in the reference images. Use all reference views for the same replacement object. Match its original position, scale, perspective, motion, contact, shadows and occlusions. Leave other people and objects unchanged.'+legacyTail,
 'Edit the main subject or object in the source video using the identity, appearance, clothing and visual details shown in the reference images. Apply those details only to the corresponding subject or object, consistently throughout the clip. Keep unrelated people, objects and scene elements unchanged.'+legacyTail
];
const extra=text=>{const value=String(text||'').trim();return value&&!legacy.includes(value)?value.slice(0,2000):'';};
function build({mode,imageCount,prompt}){
 const tags=Array.from({length:Math.max(0,imageCount||0)},(_,i)=>`@Image ${i+1}`).join(', '),also=extra(prompt);
 return [(modes[mode]||modes.motion)(tags),strict,consistency,
  also?`Follow the user's prompt strictly and exactly. Where it conflicts with anything above, the user's prompt wins.\nUser's prompt: ${also}`:''
 ].filter(Boolean).join('\n\n');
}
module.exports={build,extra,legacy};
