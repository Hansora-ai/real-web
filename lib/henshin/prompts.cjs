/* Built-in Henshin instructions. Server-only: never serve this file or store the built
  prompt where users can read it. The user's text is appended as an extra request. */
'use strict';
const preserve=[
 'Recreate @Video 1 exactly, frame by frame. It is the only master for everything that is not being replaced or edited.',
 'Keep the exact same duration, timing, speed, shot sequence and cuts. Do not add, remove or reorder any shot.',
 'Keep the exact same camera: position, height, angle, lens, framing, crop and every camera movement (pans, tilts, shakes, handheld motion). Do not add zooms, reframing, new angles, slow motion or transitions.',
 'Keep the exact same location, background, set, props, lighting, shadows, color grading, weather and time of day.',
 'Keep every person, animal and object that is not being changed exactly as in @Video 1: same faces, bodies, clothing, positions, movements, actions and expressions.',
 'Do not add or remove people, objects, text, logos, captions, effects or filters.'
].join('\n');
const consistency='Keep the change identical in every frame, including turns, fast motion, motion blur, close-ups, partial occlusion and when it leaves and re-enters the frame. No flicker, morphing or identity drift.';
const modes={
 motion:tags=>[
  `Change only one thing: replace the main character of @Video 1 (the most prominent person) with the character shown in ${tags}.`,
  `Take only the character's look from ${tags}: face, facial features, hair, skin tone, body shape, clothing and accessories. Treat all reference images as the same character.`,
  "Take everything else from @Video 1: every pose, gesture, step, dance move, facial expression, lip movement, eye direction, timing and rhythm, and the character's exact position, size and placement in the frame.",
  'Ignore the pose, camera angle, framing, background and lighting of the reference images.'
 ].join('\n'),
 swap:tags=>[
  `Change only one thing: replace the main object in @Video 1 that matches the kind of object shown in ${tags} with the object from the reference images.`,
  'Treat all reference images as views of the same object and copy its exact shape, proportions, colors, materials, textures, logos, text and details.',
  "The new object takes the original object's place exactly: same position, size, perspective, rotation, movement, how it is held, worn or touched, contact with hands and surfaces, shadows, reflections and anything passing in front of it.",
  'Do not change the people holding or using it, or any other object.'
 ].join('\n'),
 edit:tags=>[
  `Change only the main subject or object of @Video 1, applying the visual details shown in ${tags}: appearance, clothing, colors, materials, textures, patterns and style.`,
  'Apply those details only to the matching subject or object. Keep its shape, movement, pose, actions, position and size exactly as in @Video 1.',
  'Do not change any other person, object or part of the scene.'
 ].join('\n')
};
// Defaults the editors pre-filled into the prompt box before this change; they mean "no extra request".
const legacyTail=' Preserve the source video’s exact camera angles, camera movement, framing, shot sequence, timing, actions, lighting and background. Do not introduce cuts, zooms, extra subjects or identity drift.';
const legacy=[
 'Replace the main character using the reference images. Match every original movement, expression, pose, timing and rhythm. Use the images for identity and appearance, never their camera angle or pose.'+legacyTail,
 'Replace the primary object in the source video that matches the object category shown in the reference images. Use all reference views for the same replacement object. Match its original position, scale, perspective, motion, contact, shadows and occlusions. Leave other people and objects unchanged.'+legacyTail,
 'Edit the main subject or object in the source video using the identity, appearance, clothing and visual details shown in the reference images. Apply those details only to the corresponding subject or object, consistently throughout the clip. Keep unrelated people, objects and scene elements unchanged.'+legacyTail
];
const extra=text=>{const value=String(text||'').trim();return value&&!legacy.includes(value)?value.slice(0,2000):'';};
function build({mode,imageCount,hasAudio,prompt}){
 const tags=Array.from({length:Math.max(1,imageCount||0)},(_,i)=>`@Image ${i+1}`).join(', '),also=extra(prompt);
 return [(modes[mode]||modes.motion)(tags),preserve,consistency,
  hasAudio?'Use @Audio 1 only as the timing and rhythm reference. Keep every movement and lip movement in sync with it.':'',
  also?`Also do this: ${also}\nMake exactly this extra change as well. Everything it does not mention stays exactly as described above.`:''
 ].filter(Boolean).join('\n\n');
}
module.exports={build,extra,legacy};
