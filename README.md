# MoniMonitor Website

A modern financial tracking application built with React, Vite, and Tailwind CSS. This dashboard allows users to monitor their income, expenses, and savings with a visual and interactive interface.

## Features

- **Financial Dashboard**: visualize net amounts, income, and expenses.
- **Transaction Management**: Add, edit, and view monthly transactions.
- **Telegram Integration**: Designed to work seamlessly as a Telegram WebApp.
- **Responsive Design**: optimized for mobile and desktop views.

## Tech Stack

- **Framework**: [React](https://react.dev/) + [Vite](https://vitejs.dev/)
- **Language**: JavaScript / TypeScript (Migrating)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/) + CSS Modules
- **State Management**: React Hooks (moving to Context API)
- **Routing**: React Router DOM

## Getting Started

### Prerequisites

- Node.js (v18 or higher recommended)
- npm or yarn

### Installation

1.  Clone the repository:
    ```bash
    git clone <repository-url>
    cd MoniMonitor_Website
    ```

2.  Install dependencies:
    ```bash
    npm install
    ```

### Running Locally

To start the development server:
```bash
npm run dev
```
The app will be available at `http://localhost:3000`.

### Backend / Mock Data

This project currently uses:
- **Mock Data**: stored in `src/services/` or `db.json` for development.
- **JSON Server**: if using `db.json`, run:
  ```bash
  npx json-server --watch server/db.json --port 3001
  ```
  *(Check `package.json` for specific server scripts)*

## Project Structure

```
MoniMonitor_Website/
├── public/              # Static assets
├── server/              # Backend / Database mock files
├── src/
│   ├── components/      # Reusable UI components
│   ├── pages/           # Page views (Dashboard, Transactions, etc.)
│   ├── hooks/           # Custom React hooks
│   ├── services/        # API services
│   ├── utils/           # Helper functions
│   ├── App.jsx          # Main entry point
│   └── main.jsx         # React DOM render
└── package.json         # Project dependencies and scripts
```

## Contributing

1.  Create a feature branch (`git checkout -b feature/AmazingFeature`).
2.  Commit your changes (`git commit -m 'Add some AmazingFeature'`).
3.  Push to the branch (`git push origin feature/AmazingFeature`).
4.  Open a Pull Request.
