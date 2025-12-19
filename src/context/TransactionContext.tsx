import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode } from "react";
import { useTransactionData, useMainPageMonth, useTelegramWebApp } from "../hooks/useSharedHooks";

// Define the shape of the context
interface TransactionContextType {
    userData: any;
    setUserData: React.Dispatch<React.SetStateAction<any>>;
    amountDetails: {
        income: number;
        expense: number;
        saving: number;
        net: number;
    };
    setAmountDetails: React.Dispatch<React.SetStateAction<any>>;
    whichMonth: number;
    setWhichMonth: React.Dispatch<React.SetStateAction<number>>;
    mainPageMonth: number;
    setMainPageMonth: React.Dispatch<React.SetStateAction<number>>;
    transactionsData: any[];
    allTransactions: any[];
    netAmountsData: any;
    availabilityData: any[];
    mainSelected: any;
    monthData: any;
    isDateClicked: boolean;
    setIsDateClicked: React.Dispatch<React.SetStateAction<boolean>>;
    isMoreClicked: string | number | null;
    setIsMoreClicked: React.Dispatch<React.SetStateAction<string | number | null>>;
    isAddClicked: string | number | null;
    setIsAddClicked: React.Dispatch<React.SetStateAction<string | number | null>>;
    dataLoaded: boolean;
}

const TransactionContext = createContext<TransactionContextType | undefined>(undefined);

export const TransactionProvider = ({ children }: { children: ReactNode }) => {
    // --- User State ---
    const [userData, setUserData] = useState({
        userId: "",
        userName: "",
        userUsername: "",
        userLanguage: "",
        queryId: "",
    });

    // --- UI State ---
    const [isMoreClicked, setIsMoreClicked] = useState<string | number | null>(null);
    const [isAddClicked, setIsAddClicked] = useState<string | number | null>(null);
    const [isDateClicked, setIsDateClicked] = useState(false);
    const [dataLoaded, setDataLoaded] = useState(false);

    // --- Transaction Logic ---
    const [whichMonth, setWhichMonth] = useState(0);
    const { mainPageMonth, setMainPageMonth } = useMainPageMonth();

    // Initialize Telegram WebApp
    useTelegramWebApp(setUserData);

    // Fetch Data
    const currentUserId = userData.userId || 90260003;

    const monthData = useTransactionData(whichMonth, currentUserId);

    const {
        Availability: availabilityData,
        netAmounts: netAmountsData,
        transactions: transactionsData,
        allTransactions: allTransactionsData,
    } = useTransactionData(whichMonth, userData.userId);

    const { selected: mainSelected } = useTransactionData(
        mainPageMonth,
        userData.userId
    );

    // Check if data is loaded
    useEffect(() => {
        if (
            Object.keys(mainSelected).length > 0 &&
            availabilityData.length > 0 &&
            !dataLoaded
        ) {
            setDataLoaded(true);
        }
    }, [mainSelected, availabilityData, dataLoaded]);

    // Amount Details 
    const [amountDetails, setAmountDetails] = useState({
        income: 0,
        expense: 0,
        saving: 0,
        net: 0,
    });

    // Value Object
    const value = useMemo(() => ({
        userData,
        setUserData,
        amountDetails,
        setAmountDetails,
        whichMonth,
        setWhichMonth,
        mainPageMonth,
        setMainPageMonth,
        transactionsData,
        allTransactions: allTransactionsData,
        netAmountsData,
        availabilityData,
        mainSelected,
        monthData,
        isDateClicked,
        setIsDateClicked,
        isMoreClicked,
        setIsMoreClicked,
        isAddClicked,
        setIsAddClicked,
        dataLoaded
    }), [
        userData,
        amountDetails,
        whichMonth,
        mainPageMonth,
        transactionsData,
        allTransactionsData,
        netAmountsData,
        availabilityData,
        mainSelected,
        monthData,
        isDateClicked,
        isMoreClicked,
        isAddClicked,
        dataLoaded
    ]);

    const Provider = TransactionContext.Provider as any;

    return (
        <Provider value={value}>
            {children}
        </Provider>
    );
};

export const useTransactions = () => {
    const context = useContext(TransactionContext);
    if (context === undefined) {
        throw new Error("useTransactions must be used within a TransactionProvider");
    }
    return context;
};
