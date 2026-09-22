/** Shared vocabulary for both a task's own category and a team member's assignment tags — one place to add a 5th category later. */
export const taskCategories = ["developer", "designer", "seo", "copywriter"] as const;
export type TaskCategory = (typeof taskCategories)[number];

export const taskCategoryLabels: Record<TaskCategory, string> = {
  developer: "Developer",
  designer: "Designer",
  seo: "SEO",
  copywriter: "Copywriter"
};
