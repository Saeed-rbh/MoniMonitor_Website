import React from 'react';

export function useTransactionData(whichMonth: number, userId: string | number | undefined, requestedCurrency?: string): {
    currency: string;
    currencies: string[];
    selected: any;
    Availability: any[];
    netAmounts: any;
    transactions: any[];
    allTransactions: Record<string, any>;
    isLoading: boolean;
    refreshing: boolean;
    error: Error | null;
    lastUpdated: Date | null;
    refresh: () => Promise<void>;
    data: any;
};

export function useMainPageMonth(): {
    mainPageMonth: number;
    setMainPageMonth: React.Dispatch<React.SetStateAction<number>>;
};

export function useTelegramWebApp(setUserData: React.Dispatch<React.SetStateAction<any>>): void;
