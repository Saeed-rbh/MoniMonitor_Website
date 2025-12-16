
export const GetDataFromDB = async ({ userId = 90260003 }) => {
    console.log("Mocking GetDataFromDB for user:", userId);
    // Return empty array or mock data to prevent errors
    return [];
};

export const sendDataToDB = async ({ record_entry }) => {
    console.log("Mocking sendDataToDB:", record_entry);
    // Simulate successful save
    return { status: "success", message: "Mock save successful" };
};

export const GetLabel = async ({ record_entry }) => {
    console.log("Mocking GetLabel for:", record_entry);
    // Simulate logic or return default
    return "Expense";
};
