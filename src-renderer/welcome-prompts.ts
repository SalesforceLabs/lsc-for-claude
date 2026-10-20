/** Starter prompts on an empty chat. */

export type WelcomeIcon = "health" | "rep" | "sync" | "error" | "learn" | "whatsNew";

export interface WelcomePrompt {
  label: string;
  /** What goes to Roz, or into the composer when `prefill`. */
  text: string;
  /** Put `text` in the composer for the user to finish instead of sending it. */
  prefill?: boolean;
  icon: WelcomeIcon;
}

const ORG_PROMPTS: WelcomePrompt[] = [
  {
    label: "Run a health check on this org",
    text: "Run a health check on this org and tell me what to fix first.",
    icon: "health",
  },
  {
    label: "Find out why a rep can't see something",
    text: "Check why a rep can't use ",
    prefill: true,
    icon: "rep",
  },
  {
    label: "Which reps have slow or failing syncs?",
    text: "How is mobile sync doing in this org? Which reps have slow or failing syncs, and why?",
    icon: "sync",
  },
  {
    label: "Paste an error to diagnose",
    text: "I'm seeing this error: ",
    prefill: true,
    icon: "error",
  },
];

const KNOWLEDGE_PROMPTS: WelcomePrompt[] = [
  {
    label: "How do sample limits work?",
    text: "How do sample limits work in LSC, and how do I set them up?",
    icon: "learn",
  },
  {
    label: "What's new in Winter '27?",
    text: "What's new for Life Sciences Cloud in Winter '27?",
    icon: "whatsNew",
  },
];

/** With an org, things to check in it plus two questions; without one, questions only. */
export function welcomePrompts(hasOrg: boolean): WelcomePrompt[] {
  if (hasOrg) return [...ORG_PROMPTS, ...KNOWLEDGE_PROMPTS];
  return [
    ...KNOWLEDGE_PROMPTS,
    {
      label: "Walk me through Visit Management setup",
      text: "Walk me through setting up Visit Management for web and iPad.",
      icon: "learn",
    },
    {
      label: "What does a rep need to sync the iPad app?",
      text: "What does a rep need (licenses, permissions, territory, DB Schema) before the LSC iPad app syncs for them?",
      icon: "learn",
    },
  ];
}
