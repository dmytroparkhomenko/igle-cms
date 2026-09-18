export const domainStatusLabel: Record<string, string> = {
  pending_nameservers: "Waiting on nameservers",
  dns_configured: "DNS live (SSL: full)",
  ssl_active: "Fully connected (SSL: strict)",
  error: "Error"
};

export const domainStatusColor: Record<string, string> = {
  pending_nameservers: "var(--muted)",
  dns_configured: "var(--accent)",
  ssl_active: "var(--accent)",
  error: "var(--warn)"
};
