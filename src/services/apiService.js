import { sessionMetadata } from './sessionMetadata';
import { apiFetch as fetch } from './requestClient';
import { apiUrl } from "../config/api";

const API_URL = apiUrl("/MoniMonitor_ToDB");

const handleExpiredSession = (response) => {
    if (response.status !== 401 || typeof window === "undefined") return false;

    sessionMetadata.removeItem("token");
    sessionMetadata.removeItem("username");
    sessionMetadata.removeItem("userId");
    sessionMetadata.removeItem("profilePhotoUrl");
    sessionMetadata.removeItem("joinedAt");
    window.dispatchEvent(new Event('monimonitor-session-expired'));

    if (window.location.pathname !== "/login") window.location.replace("/login");
    return true;
};

export const GetDataFromDB = async ({ throwOnError = false } = {}) => {
    try {

        const response = await fetch(API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                
            },
            body: JSON.stringify({ status: "read" })
        });

        if (!response.ok) {
            handleExpiredSession(response);
            console.error("Failed to fetch data", response.status);
            if (throwOnError) throw new Error(`Failed to fetch transactions (${response.status})`);
            return [];
        }

        return await response.json();
    } catch (error) {
        console.error("Error fetching data:", error);
        if (throwOnError) throw error;
        return [];
    }
};

export const GetSummary = async () => {
    try {

        const response = await fetch(apiUrl("/summary"), {
            method: "GET",
            headers: {
                
            }
        });

        if (!response.ok) {
            handleExpiredSession(response);
            console.error("Failed to fetch summary data", response.status);
            return null;
        }

        return await response.json();
    } catch (error) {
        console.error("Error fetching summary:", error);
        return null;
    }
};

export const GetDashboardBootstrap = async (month) => {
    try {

        const response = await fetch(apiUrl(`/dashboard-bootstrap?month=${encodeURIComponent(month)}`), {
            headers: {  }
        });

        if (!response.ok) {
            handleExpiredSession(response);
            console.error("Failed to fetch dashboard bootstrap", response.status);
            return null;
        }

        return await response.json();
    } catch (error) {
        console.error("Error fetching dashboard bootstrap:", error);
        return null;
    }
};

export const updateTransactionAPI = async (id, updates) => {
    try {

        const response = await fetch(apiUrl(`/transactions/${id}`), {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                
            },
            body: JSON.stringify(updates)
        });

        if (!response.ok) {
            return { status: "error", message: "Failed to update transaction" };
        }

        return await response.json();
    } catch (error) {
        console.error("Error updating transaction:", error);
        return { status: "error", message: error.message };
    }
};

export const getTransactionSourcesAPI = async (id) => {
    try {

        const response = await fetch(apiUrl(`/transactions/${id}/sources`), {
            headers: {  },
        });
        if (!response.ok) {
            handleExpiredSession(response);
            return [];
        }
        const payload = await response.json();
        return Array.isArray(payload) ? payload : payload.sources || [];
    } catch (error) {
        console.error("Error fetching transaction sources:", error);
        return [];
    }
};

export const getTransactionRefundsAPI = async (id) => {
    const response = await fetch(apiUrl(`/transactions/${id}/refunds`), {
        headers: {  },
    });
    if (!response.ok) { handleExpiredSession(response); return []; }
    return (await response.json()).pairings || [];
};

export const deleteTransactionAPI = async (id) => {
    try {

        const response = await fetch(apiUrl(`/transactions/${id}`), {
            method: "DELETE",
            headers: {
                
            }
        });

        if (!response.ok) {
            return { status: "error", message: "Failed to delete transaction" };
        }

        return await response.json();
    } catch (error) {
        console.error("Error deleting transaction:", error);
        return { status: "error", message: error.message };
    }
};

export const sendDataToDB = async ({ record_entry, record_type }) => {
    try {

        const response = await fetch(API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                
            },
            body: JSON.stringify({
                status: "record",
                record_entry,
                record_type
            })
        });

        if (!response.ok) {
            return { status: "error", message: "Failed to save" };
        }

        return await response.json();
    } catch (error) {
        console.error("Error saving data:", error);
        return { status: "error", message: error.message };
    }
};

export const getSettingsAPI = async () => {
    const response = await fetch(apiUrl("/settings"), { headers: {  } });
    return response.ok ? response.json() : null;
};

export const saveSettingsAPI = async (settings) => {
    const response = await fetch(apiUrl("/settings"), {
        method: "PUT",
        headers: { "Content-Type": "application/json",  },
        body: JSON.stringify(settings),
    });
    return response.ok ? response.json() : null;
};

export const getBudgetsAPI = async (month) => {
    const response = await fetch(apiUrl(`/budgets?month=${encodeURIComponent(month)}`), { headers: {  } });
    return response.ok ? response.json() : [];
};

export const saveBudgetAPI = async (budget) => {
    const response = await fetch(apiUrl("/budgets"), { method: "PUT", headers: { "Content-Type": "application/json",  }, body: JSON.stringify(budget) });
    return response.ok ? response.json() : null;
};

export const getGoalsAPI = async () => {
    const response = await fetch(apiUrl("/goals"), { headers: {  } });
    return response.ok ? response.json() : [];
};

export const createGoalAPI = async (goal) => {
    const response = await fetch(apiUrl("/goals"), { method: "POST", headers: { "Content-Type": "application/json",  }, body: JSON.stringify(goal) });
    return response.ok ? response.json() : null;
};

export const updateGoalAPI = async (id, updates) => {
    const response = await fetch(apiUrl(`/goals/${id}`), { method: "PUT", headers: { "Content-Type": "application/json",  }, body: JSON.stringify(updates) });
    return response.ok ? response.json() : null;
};

export const deleteGoalAPI = async (id) => {
    const response = await fetch(apiUrl(`/goals/${id}`), { method: "DELETE", headers: {  } });
    return response.ok;
};

export const GetLabel = async ({ record_entry }) => {
    if (!record_entry) return "Other";
    if (record_entry.Label && record_entry.Label !== "Auto Detect") {
        return record_entry.Label;
    }
    if (record_entry.Category === "Income") return "Income";
    if (record_entry.Category === "Saving") return "Savings";
    return "Expense";
};

export const getMonthlyAiBriefAPI = async (month, refresh = false) => {
    try {
        const params = new URLSearchParams({ month });
        if (refresh) params.set("refresh", "true");
        const response = await fetch(apiUrl(`/insights/monthly?${params}`), {
            headers: {  },
        });
        if (!response.ok) {
            handleExpiredSession(response);
            return null;
        }
        return response.json();
    } catch (error) {
        console.error("Error fetching monthly AI brief:", error);
        return null;
    }
};

export const getExpenseForecastAPI = async () => {
    try {
        const response = await fetch(apiUrl("/insights/expense-forecast"), {
            headers: {  },
        });
        if (!response.ok) {
            handleExpiredSession(response);
            return await response.json().catch(() => ({ error: "Unable to load forecast" }));
        }
        return response.json();
    } catch (error) {
        console.error("Error fetching TimesFM forecast:", error);
        return { error: "Unable to load forecast" };
    }
};

const backupRequest = async (path = "", options = {}) => {
    const response = await fetch(apiUrl(`/backups${path}`), {
        ...options,
        headers: {
            ...(options.body ? { "Content-Type": "application/json" } : {}),
            
            ...options.headers,
        },
    });
    if (!response.ok) {
        handleExpiredSession(response);
        return null;
    }
    return response;
};

export const getBackupStatusAPI = async () => {
    const response = await backupRequest();
    return response ? response.json() : null;
};

export const createBackupAPI = async () => {
    const response = await backupRequest("", { method: "POST" });
    return response ? response.json() : null;
};

export const downloadBackupAPI = async (fileName) => {
    const response = await backupRequest(`/${encodeURIComponent(fileName)}/download`);
    if (!response) return false;
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
    return true;
};

export const restoreBackupAPI = async (fileName) => {
    const response = await backupRequest(`/${encodeURIComponent(fileName)}/restore`, {
        method: "POST",
        body: JSON.stringify({ confirm: "RESTORE" }),
    });
    return response ? response.json() : null;
};

const plaidRequest = async (path = '', options = {}) => {
    const response = await fetch(apiUrl(`/plaid${path}`), {
        ...options,
        headers: {
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            
            ...options.headers,
        },
    });
    if (!response.ok) {
        handleExpiredSession(response);
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'Plaid request failed');
    }
    return response.json();
};

export const getPlaidStatusAPI = () => plaidRequest('/status');

export const createPlaidLinkTokenAPI = (itemId) => plaidRequest('/link-token', {
    method: 'POST',
    ...(itemId ? { body: JSON.stringify({ itemId }) } : {}),
});

export const exchangePlaidPublicTokenAPI = (publicToken, metadata) => plaidRequest('/exchange', {
    method: 'POST',
    body: JSON.stringify({ publicToken, metadata }),
});

export const syncPlaidAPI = () => plaidRequest('/sync', { method: 'POST' });

export const disconnectPlaidItemAPI = (itemId) => plaidRequest(`/items/${encodeURIComponent(itemId)}`, {
    method: 'DELETE',
});

const portfolioRequest = async (path = '', options = {}) => {
    const response = await fetch(apiUrl(`/portfolio${path}`), {
        ...options,
        headers: {
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            
            ...options.headers,
        },
    });
    if (!response.ok) {
        handleExpiredSession(response);
        return null;
    }
    return response.status === 204 ? true : response.json();
};

export const getPortfolioAPI = () => portfolioRequest();

export const getPortfolioCorrectionAPI = (id) => portfolioRequest(`/transactions/${id}/correction`);
export const submitPortfolioCorrectionAPI = async (id, action, input) => {
    const response = await fetch(apiUrl(`/portfolio/transactions/${id}/${action}`), {
        method: 'POST', headers: { 'Content-Type': 'application/json',  },
        body: JSON.stringify(input),
    });
    if (!response.ok) {
        handleExpiredSession(response);
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || 'Portfolio correction failed');
    }
    return response.json();
};

export const createInvestmentAccountAPI = (account) => portfolioRequest('/accounts', {
    method: 'POST',
    body: JSON.stringify(account),
});

export const updateInvestmentAccountAPI = (id, updates) => portfolioRequest(`/accounts/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
});

export const deleteInvestmentAccountAPI = (id) => portfolioRequest(`/accounts/${id}`, {
    method: 'DELETE',
});

export const saveInvestmentHoldingAPI = (accountId, holding) => portfolioRequest(`/accounts/${accountId}/holdings`, {
    method: 'PUT',
    body: JSON.stringify(holding),
});

export const deleteInvestmentHoldingAPI = (accountId, holdingId) => portfolioRequest(
    `/accounts/${accountId}/holdings/${holdingId}`,
    { method: 'DELETE' },
);
