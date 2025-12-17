import React from 'react';

export function useTransactionData(whichMonth: number, userId: string | number | undefined): {
    selected: any;
    Availability: any[];
    netAmounts: any;
    transactions: any[];
};

export function useMainPageMonth(): {
    mainPageMonth: number;
    setMainPageMonth: React.Dispatch<React.SetStateAction<number>>;
};

export function useTelegramWebApp(setUserData: React.Dispatch<React.SetStateAction<any>>): void;
