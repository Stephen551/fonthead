/* fonthead.dev — shared data + helpers (community fonts are stand-ins
   rendered in real Google Fonts until the user supplies their own files). */

// gradient + flat colors live in data so each color font carries its own.
const FH_FONTS = [
  { id:"neon-arcade", name:"Neon Arcade", maker:"pixel.mara", word:"Replay",
    family:"'Monoton', cursive", size:96, treat:"normal", badge:null,
    votes:521, fav:true, vis:"public", glyphs:188, otf:"39 KB", ttf:"47 KB", woff2:"24 KB" },
  { id:"ember-flux", name:"Ember Flux", maker:"rosa.makes", word:"Bakery",
    family:"'Anton', sans-serif", size:104, treat:"gradient",
    grad:"linear-gradient(96deg,#ff6a2c 4%,#ff2e6e 96%)", badge:"color",
    votes:412, fav:false, vis:"public", glyphs:212, otf:"58 KB", ttf:"66 KB", woff2:"31 KB" },
  { id:"fatcap", name:"Fatcap Deck", maker:"studio.veld", word:"Verona",
    family:"'Abril Fatface', serif", size:96, treat:"normal", badge:null,
    votes:356, fav:true, vis:"public", glyphs:241, otf:"71 KB", ttf:"82 KB", woff2:"38 KB" },
  { id:"console-78", name:"Console 78", maker:"retro.dev", word:"uptime",
    family:"'VT323', monospace", size:108, treat:"normal", badge:null,
    votes:309, fav:false, vis:"public", glyphs:201, otf:"33 KB", ttf:"41 KB", woff2:"19 KB" },
  { id:"patio", name:"Patio Script", maker:"cricut.carl", word:"Saturday",
    family:"'Pacifico', cursive", size:80, treat:"normal", badge:null,
    votes:287, fav:false, vis:"public", glyphs:196, otf:"61 KB", ttf:"70 KB", woff2:"33 KB" },
  { id:"helio", name:"Helio Variable", maker:"type.shop", word:"Weight",
    family:"'Fraunces', serif", size:96, treat:"variable", badge:"variable",
    votes:263, fav:false, vis:"public", glyphs:334, otf:"118 KB", ttf:"131 KB", woff2:"58 KB" },
  { id:"block-press", name:"Block Press", maker:"arcade.ann", word:"PIXEL",
    family:"'Silkscreen', sans-serif", size:72, treat:"normal", badge:null,
    votes:244, fav:true, vis:"public", glyphs:142, otf:"21 KB", ttf:"26 KB", woff2:"12 KB" },
  { id:"marigold", name:"Marigold", maker:"field.notes", word:"Marigold",
    family:"'DM Serif Display', serif", size:88, treat:"normal", badge:null,
    votes:233, fav:false, vis:"public", glyphs:228, otf:"54 KB", ttf:"62 KB", woff2:"29 KB" },
  { id:"linecut", name:"Linecut One", maker:"plotter.pete", word:"Plotter",
    family:"'Outfit', sans-serif", size:84, treat:"line", badge:"line",
    votes:198, fav:false, vis:"public", glyphs:160, otf:"28 KB", ttf:"34 KB", woff2:"16 KB" },
  { id:"quill", name:"Quill Note", maker:"quiet.press", word:"Letters",
    family:"'Spectral', serif", italic:true, size:88, treat:"normal", badge:null,
    votes:178, fav:false, vis:"public", glyphs:286, otf:"77 KB", ttf:"88 KB", woff2:"41 KB" },
  { id:"bumper", name:"Bumper", maker:"sticker.shop", word:"STICKER",
    family:"'Bungee', sans-serif", size:72, treat:"flat", flat:"#1f6feb", badge:"color",
    votes:167, fav:false, vis:"public", glyphs:174, otf:"44 KB", ttf:"52 KB", woff2:"25 KB" },
  { id:"chalkline", name:"Chalkline", maker:"teacher.kim", word:"Recess",
    family:"'Gloria Hallelujah', cursive", size:72, treat:"normal", badge:null,
    votes:142, fav:false, vis:"private", glyphs:181, otf:"49 KB", ttf:"57 KB", woff2:"27 KB" },
];

// hero cycles the SAME word through faces the community made.
const FH_HERO_FACES = [
  { family:"'Bungee', sans-serif", treat:"normal", maker:"sticker.shop", label:"display" },
  { family:"'Anton', sans-serif", treat:"gradient",
    grad:"linear-gradient(96deg,#ff6a2c,#ff2e6e)", maker:"rosa.makes", label:"color · gradient" },
  { family:"'Outfit', sans-serif", treat:"line", maker:"plotter.pete", label:"single-line" },
  { family:"'Monoton', cursive", treat:"normal", maker:"pixel.mara", label:"display" },
  { family:"'Pacifico', cursive", treat:"normal", maker:"cricut.carl", label:"script" },
  { family:"'Fraunces', serif", italic:true, treat:"normal", maker:"type.shop", label:"variable" },
];

// apply a treatment as inline style on a specimen element
function specStyle(f) {
  const s = { fontFamily: f.family, fontStyle: f.italic ? "italic" : "normal" };
  if (f.treat === "gradient") s.backgroundImage = f.grad;
  if (f.treat === "variable") s.fontVariationSettings = '"opsz" 144, "wght" 600, "SOFT" 0';
  return s;
}
function specClass(f) {
  return "spec" +
    (f.treat === "gradient" ? " spec--gradient" :
     f.treat === "line"     ? " spec--line" :
     f.treat === "flat"     ? " spec--flat" : "");
}

// heart + caret glyphs (the only icons; type carries the rest)
const Heart = ({}) => React.createElement("svg", { viewBox:"0 0 24 24" },
  React.createElement("path", { d:"M12 20s-7-4.4-9.2-8.3C1.3 8.9 2.6 5.5 5.8 5.5c2 0 3.3 1.4 3.9 2.4 0 0 .1.2.3.2s.3-.2.3-.2c.6-1 1.9-2.4 3.9-2.4 3.2 0 4.5 3.4 3 6.2C19 15.6 12 20 12 20z" }));
const Caret = () => React.createElement("svg", { viewBox:"0 0 9 9" },
  React.createElement("path", { d:"M1.5 5.5L4.5 2.5L7.5 5.5" }));

Object.assign(window, { FH_FONTS, FH_HERO_FACES, specStyle, specClass, Heart, Caret });
