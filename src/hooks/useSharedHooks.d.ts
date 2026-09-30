import React from 'react';

export function useTransactionData(whichMonth: number, userId: string | number | null | undefined): {
    selected: any;
    Availability: any[];
    netAmounts: any;
    transactions: any[];
    allTransactions: Record<string, any>;
    isLoading: boolean;
    isOffline: boolean;
    error: Error | null;
    refetch: () => Promise<void>;
};

export function useMainPageMonth(): {
    mainPageMonth: number;
    setMainPageMonth: React.Dispatch<React.SetStateAction<number>>;
};

export function useTelegramWebApp(setUserData: React.Dispatch<React.SetStateAction<any>>): void;
