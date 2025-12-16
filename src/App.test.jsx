import { render, screen, waitFor } from '@testing-library/react';
import App from './App';
import React from 'react';
import { vi } from 'vitest';

// Mock axios to avoid network errors
vi.mock('axios', () => ({
  default: {
    post: vi.fn(() => Promise.resolve({ data: [] })),
    get: vi.fn(() => Promise.resolve({ data: [] })),
  },
}));

// Mock scrollableList since it relies on DOM properties not present in JSDOM
vi.mock('./components/ScrollableList', () => ({
  default: () => <div>ScrollableList</div>,
}));

// Mock hooks to avoid async logic and side effects
vi.mock('./hooks/useSharedHooks', () => ({
  useTransactionData: () => ({
    Availability: [],
    netAmounts: [],
    transactions: [],
    selected: {},
  }),
  useMainPageMonth: () => ({
    mainPageMonth: 0,
    setMainPageMonth: vi.fn(),
  }),
  useTelegramWebApp: vi.fn(),
}));


test('renders MoniMonitor app without crashing', async () => {
  render(<App />);
  // Check for Loading state first
  const loadingElement = screen.getByText(/Loading.../i);
  expect(loadingElement).toBeInTheDocument();
});
