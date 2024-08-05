import axios from "axios";

export const sendDataToDB = async ({ record_entry }) => {
  const { Type, ...rest } = record_entry;
  const data = {
    status: "record",
    record_entry: rest,
    user_id: 90260003,
    record_type: Type,
  };
  try {
    await axios.post(
      "https://2h8gfybwsd.execute-api.us-east-1.amazonaws.com/MoniMonitor_ToDB",
      data,
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("Error sendDataToDB:", error);
  }
};

export const GetLabel = async ({ record_entry }) => {
  const { Type, ...rest } = record_entry;
  const data = {
    record_entry: rest,
  };
  try {
    const response = await axios.post(
      "https://rxpr0qyikg.execute-api.us-east-1.amazonaws.com/MoniMonitor_Openai",
      data,
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
    return response.data;
  } catch (error) {
    return "other";
  }
};

export const GetDataFromDB = async ({ userId = 90260003 }) => {
  const data = {
    status: "read",
    user_id: userId,
  };
  try {
    const response = await axios.post(
      "https://2h8gfybwsd.execute-api.us-east-1.amazonaws.com/MoniMonitor_ToDB",
      data,
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
    return response.data;
  } catch (error) {
    console.error("Error GetDataFromDB:", error);
  }
};
