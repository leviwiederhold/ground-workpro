# Groundwork Pro

The all-in-one management platform for excavation and grading contractors.

## Features

- **Dashboard** - Real-time overview of operations, jobs, and equipment
- **Team Messaging** - Built-in Slack-like communication with channels and DMs
- **Fleet Management** - Track equipment location, hours, and maintenance
- **Smart Scheduling** - Drag-and-drop crew and equipment scheduling
- **Job Costing** - Track costs, budgets, and profitability in real-time
- **Safety & Compliance** - Digital sign-offs, incident tracking, certifications
- **40+ Integrations** - Connect QuickBooks, Samsara, Procore, and more

## Quick Start

1. Clone this repo
2. Open `index.html` in your browser
3. Or deploy to GitHub Pages

## Deploy to GitHub Pages

1. Go to repo Settings > Pages
2. Source: Deploy from branch
3. Branch: `main` / `root`
4. Save

Your site will be live at `https://yourusername.github.io/groundwork-pro`

## Customization

### Images
Update the `IMAGES` config in `index.html` (around line 4690) with your photo URLs:

```javascript
const IMAGES = {
  hero: 'https://your-url.com/hero.jpg',
  ctaBg: 'https://your-url.com/cta.jpg',
  gallery: ['url1', 'url2', ...]
};
```

### Fonts
The Dozer font (`Dozer.ttf`) must be in the same directory as `index.html`.

## Tech Stack

- React 18
- Tailwind CSS
- Font Awesome Icons
- Chart.js
- Leaflet.js (Maps)

## License

Proprietary - All rights reserved
