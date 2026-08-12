import { MarketingChrome } from "@/app/components/marketing/MarketingChrome";

const testimonials = [
  {
    name: "Marcus Johnson",
    role: "Owner, Johnson Excavating",
    quote: "Groundwork Pro cut our admin time in half. Scheduling alone saves us hours every week.",
    initials: "MJ",
  },
  {
    name: "Sarah Williams",
    role: "Manager, Williams Grading",
    quote: "This feels built for excavation teams. Job costing and fleet visibility changed how we run projects.",
    initials: "SW",
  },
  {
    name: "Robert Chen",
    role: "Owner, Pacific Earthworks",
    quote: "We moved from spreadsheets to one operating system. The visibility is night and day.",
    initials: "RC",
  },
];

export default function TestimonialsPage() {
  return (
    <MarketingChrome
      title="Testimonials"
      subtitle="What excavation and grading contractors say after switching to Groundwork Pro."
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {testimonials.map((item) => (
          <div key={item.name} className="bg-white border border-gray-200 rounded-xl p-6">
            <div className="flex items-center gap-1 text-yellow-500 mb-3">
              <i className="fa-solid fa-star"></i>
              <i className="fa-solid fa-star"></i>
              <i className="fa-solid fa-star"></i>
              <i className="fa-solid fa-star"></i>
              <i className="fa-solid fa-star"></i>
            </div>
            <p className="text-gray-700 text-sm">&ldquo;{item.quote}&rdquo;</p>
            <div className="flex items-center gap-3 mt-5">
              <div className="w-10 h-10 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center font-semibold">
                {item.initials}
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">{item.name}</p>
                <p className="text-xs text-gray-500">{item.role}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </MarketingChrome>
  );
}
