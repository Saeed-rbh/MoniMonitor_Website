const API_URL = "http://localhost:3001/MoniMonitor_ToDB";

export const GetDataFromDB = async ({ userId } = {}) => {
    try {
        const token = localStorage.getItem("token");
        if (!token) return [];

        const response = await fetch(API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({ status: "read" })
        });

        if (!response.ok) {
            console.error("Failed to fetch data", response.status);
            return [];
        }

        return await response.json();
    } catch (error) {
        console.error("Error fetching data:", error);
        return [];
    }
};

export const sendDataToDB = async ({ record_entry, record_type }) => {
    try {
        const token = localStorage.getItem("token");
        if (!token) return { status: "error", message: "Not authenticated" };

        const response = await fetch(API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
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

export const GetLabel = async ({ record_entry }) => {
    // Keep mock for OpenAI for now or update if backend has endpoint
    // The backend had /MoniMonitor_Openai but we are not focusing on that for auth
    console.log("Mocking GetLabel for:", record_entry);
    return "Expense";
};
