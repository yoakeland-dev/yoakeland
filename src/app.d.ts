declare const __APP_VERSION__: string;

// KaTeX ships mhchem without types; importing it is all it takes (mathRender.ts).
declare module "katex/contrib/mhchem";
