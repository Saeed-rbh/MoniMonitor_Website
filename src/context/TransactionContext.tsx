import React, { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { useAuth } from "./AuthContext";
import { getSelectedMonthData } from "../services/transactionService";
import { useMainPageMonth, useTransactionData } from "../hooks/useSharedHooks";

type UserData = {
    userId: string;
    userName: string;
    userUsername: string;
    userLanguage: string;
    queryId: string;
};

interface TransactionContextType {
    userData: UserData;
    setUserData: React.Dispatch<React.SetStateAction<UserData>>;
    amountDetails: { income: number; expense: number; saving: number; net: number };
    setAmountDetails: React.Dispatch<React.SetStateAction<{ income: number; expense: number; saving: number; net: number }>>;
    whichMonth: number;
    setWhichMonth: React.Dispatch<React.SetStateAction<number>>;
    mainPageMonth: number;
    setMainPageMonth: React.Dispatch<React.SetStateAction<number>>;
    transactionsData: any[];
    allTransactions: Record<string, any>;
    netAmountsData: Record<string, any>;
    availabilityData: any[];
    mainSelected: Record<string, any>;
    monthData: Record<string, any>;
    isDateClicked: boolean;
    setIsDateClicked: React.Dispatch<React.SetStateAction<boolean>>;
    isMoreClicked: string | number | null;
    setIsMoreClicked: React.Dispatch<React.SetStateAction<string | number | null>>;
    isAddClicked: string | number | null;
    setIsAddClicked: React.Dispatch<React.SetStateAction<string | number | null>>;
    dataLoaded: boolean;
}

const TransactionContext = createContext<TransactionContextType | undefined>(undefined);

const emptyUser: UserData = { userId: "", userName: "", userUsername: "", userLanguage: "", queryId: "" };

export const TransactionProvider = ({ children }: { children: ReactNode }) => {
    const { user } = useAuth();
    const [userData, setUserData] = useState<UserData>(emptyUser);
    const [isMoreClicked, setIsMoreClicked] = useState<string | number | null>(null);
    const [isAddClicked, setIsAddClicked] = useState<string | number | null>(null);
    const [isDateClicked, setIsDateClicked] = useState(false);
    const [whichMonth, setWhichMonth] = useState(0);
    const { mainPageMonth, setMainPageMonth } = useMainPageMonth();
    const [amountDetails, setAmountDetails] = useState({ income: 0, expense: 0, saving: 0, net: 0 });

    // The API derives ownership exclusively from the authenticated session. Telegram
    // metadata is display-only until it has been verified and linked server-side.
    useEffect(() => {
        setUserData({
            userId: user?.userId ? String(user.userId) : "",
            userName: user?.username || "",
            userUsername: user?.username || "",
            userLanguage: "",
            queryId: "",
        });
    }, [user]);

    const monthData = useTransactionData(whichMonth, user?.userId);
    const { selected: mainSelected } = useMemo(
        () => getSelectedMonthData(monthData.allTransactions, mainPageMonth),
        [monthData.allTransactions, mainPageMonth]
    );

    const value = useMemo(() => ({
        userData,
        setUserData,
        amountDetails,
        setAmountDetails,
        whichMonth,
        setWhichMonth,
        mainPageMonth,
        setMainPageMonth,
        transactionsData: monthData.transactions,
        allTransactions: monthData.allTransactions,
        netAmountsData: monthData.netAmounts,
        availabilityData: monthData.Availability,
        mainSelected,
        monthData,
        isDateClicked,
        setIsDateClicked,
        isMoreClicked,
        setIsMoreClicked,
        isAddClicked,
        setIsAddClicked,
        dataLoaded: !monthData.isLoading,
    }), [
        userData, amountDetails, whichMonth, mainPageMonth, monthData, mainSelected,
        isDateClicked, isMoreClicked, isAddClicked,
    ]);

    return <TransactionContext.Provider value={value}>{children}</TransactionContext.Provider>;
};

export const useTransactions = () => {
    const context = useContext(TransactionContext);
    if (!context) throw new Error("useTransactions must be used within a TransactionProvider");
    return context;
};
