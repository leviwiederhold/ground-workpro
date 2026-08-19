import { MarketingChrome } from "@/app/components/marketing/MarketingChrome";

function FeatureIcon({ icon }: { icon: string }) {
  const resolved =
    {
      "truck-field": "truck",
      "calendar-week": "calendar-days",
      "money-check-dollar": "file-invoice-dollar",
      "shield-heart": "shield-halved",
      "grid-2": "table-columns",
    }[icon] || icon;

  if (icon === "dashboard") {
    return (
      <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
        <rect x="3.5" y="4" width="17" height="16" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <rect x="6.5" y="7" width="4" height="4" rx="0.8" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <rect x="13.5" y="7" width="4" height="4" rx="0.8" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <rect x="6.5" y="13" width="4" height="4" rx="0.8" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M13.5 15h4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M15.5 13v4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }

  return <i className={`fa-solid fa-${resolved}`}></i>;
}

const features = [
  {
    title: "Unified Dashboard",
    desc: "See jobs, equipment, team, safety, and costs from one central workspace.",
    icon: "dashboard",
  },
  {
    title: "Equipment Management",
    desc: "Track equipment status, assignments, maintenance, and utilization in real time.",
    icon: "truck-field",
  },
  {
    title: "Smart Scheduling",
    desc: "Coordinate crews, equipment, and jobs with fewer conflicts and delays.",
    icon: "calendar-week",
  },
  {
    title: "Team Messaging",
    desc: "Company-scoped channels and messages to keep field and office aligned.",
    icon: "comments",
  },
  {
    title: "Job Costing",
    desc: "Track actuals vs estimates and watch margin drift before it becomes a problem.",
    icon: "money-check-dollar",
  },
  {
    title: "Safety & Compliance",
    desc: "Manage safety logs, incidents, and certifications with auditable workflows.",
    icon: "shield-heart",
  },
];

export default function FeaturesPage() {
  return (
    <MarketingChrome
      title="Features"
      subtitle="Built for excavation and grading operations, not generic office workflows."
    >
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {features.map((feature) => (
          <div key={feature.title} className="bg-white border border-gray-200 rounded-xl p-6">
            <div className="w-11 h-11 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center mb-3">
              <FeatureIcon icon={feature.icon} />
            </div>
            <h2 className="text-lg font-semibold text-gray-900">{feature.title}</h2>
            <p className="text-sm text-gray-600 mt-2">{feature.desc}</p>
          </div>
        ))}
      </div>
    </MarketingChrome>
  );
}
