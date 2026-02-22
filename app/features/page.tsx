import { MarketingChrome } from "@/app/components/marketing/MarketingChrome";

const features = [
  {
    title: "Unified Dashboard",
    desc: "See jobs, fleet, team, safety, and costs from one central workspace.",
    icon: "grid-2",
  },
  {
    title: "Fleet Management",
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
              <i className={`fa-solid fa-${feature.icon}`}></i>
            </div>
            <h2 className="text-lg font-semibold text-gray-900">{feature.title}</h2>
            <p className="text-sm text-gray-600 mt-2">{feature.desc}</p>
          </div>
        ))}
      </div>
    </MarketingChrome>
  );
}
