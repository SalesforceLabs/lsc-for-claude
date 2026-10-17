// SLDS glyphs from the app's AppPalette asset catalog (APIcon.xcassets/icons/standard), drawn white on the
// object theme colour. The app resolves a theme's iconPath to these and falls back to standard:custom
// (the wrench) when the catalog has no such name, which is what Inquiry (work_plan_selection_rule) gets.

function Glyph({ viewBox, d }: { viewBox: string; d: string }) {
  return (
    <svg width="100%" height="100%" viewBox={viewBox} fill="#fff" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const CUSTOM = { viewBox: "0 0 1000 1000", d: "M792 328c-2-7-11-9-17-4L674 425c-8 8-20 8-28 0l-71-71c-8-8-8-20 0-28l102-102c5-5 3-14-4-17-17-4-35-7-53-7a180 180 0 0 0-167 247L220 681a71 71 0 0 0 50 120c18 0 36-7 50-21l233-233a180 180 0 0 0 239-219z" };
export const CustomIcon = () => <Glyph {...CUSTOM} />;

const FILE = { viewBox: "0 0 1000 1000", d: "M290 630V310c-33 0-60 27-60 60v380c0 33 27 60 60 60h300c33 0 60-27 60-60H410c-66 0-120 0-120-120zm460-260H650c-33 0-60-27-60-60V210c0-11-9-20-20-20H410c-33 0-60 27-60 60v380c0 33 27 60 60 60h300c33 0 60-27 60-60V390c0-11-9-20-20-20zm16-84-92-92c-3-3-6-4-10-4-8 0-14 6-14 14v66c0 22 18 40 40 40h66c8 0 14-6 14-14 0-4-1-7-4-10z" };
export const FileIcon = () => <Glyph {...FILE} />;

const PERSON_ACCOUNT = { viewBox: "0 0 100 100", d: "M69.5 59c-3.6-1.5-4.2-2.9-4.2-4.4s1-2.9 2.2-4c2.1-1.9 3.3-4.6 3.3-7.8 0-5.8-3.7-10.9-10.2-10.9s-10.2 5-10.2 10.9c0 3.2 1.2 5.8 3.3 7.8 1.2 1.1 2.2 2.5 2.2 4s-.6 2.9-4.2 4.4c-5.3 2.2-10.4 5-10.5 9.8 0 3.1 2.4 6.2 5.4 6.2h27.8c3.1 0 5.4-3.1 5.4-6.2.1-4.7-5-7.5-10.3-9.8zm-22.9-7.6c-.4-.5-2.4-3-2.2-9.7.1-6.6 3-8.3 3-8.3v-6.5c0-1.1-1.1-1.9-1.9-1.9H21.9c-.9 0-1.9.9-1.9 2v43.6h13.5c.3-11.1 13-15.6 13-15.6 1.9-1 .5-3.1.1-3.6zM30.7 65.1a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-2c0-1.1.9-2 2-2h2a2 2 0 0 1 2 2zm0-9.9a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-2c0-1.1.9-2 2-2h2a2 2 0 0 1 2 2zm0-9.9a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-2c0-1.1.9-2 2-2h2a2 2 0 0 1 2 2zm0-9.9a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-2c0-1.1.9-2 2-2h2a2 2 0 0 1 2 2zm11.2 19.8a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-2c0-1.1.9-2 2-2h2a2 2 0 0 1 2 2zm0-9.9a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-2c0-1.1.9-2 2-2h2a2 2 0 0 1 2 2zm0-9.9a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-2c0-1.1.9-2 2-2h2a2 2 0 0 1 2 2z" };
export const PersonAccountIcon = () => <Glyph {...PERSON_ACCOUNT} />;
