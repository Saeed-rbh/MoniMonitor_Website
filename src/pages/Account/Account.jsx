import React from "react";
import { ScalableElement } from "../../utils/tools";
import { IoPersonCircleOutline, IoSettingsOutline, IoLogOutOutline } from "react-icons/io5";

const Account = () => {
    const sectionStyle = {
        backgroundColor: "var(--Bc-4)",
        borderRadius: "15px",
        padding: "20px",
        marginBottom: "15px",
        display: "flex",
        flexDirection: "column",
        gap: "10px"
    };

    const itemStyle = {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 0",
        borderBottom: "1px solid var(--Ac-4)",
        cursor: "pointer",
        color: "var(--Ac-1)"
    };

    return (
        <div style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            padding: "20px",
            paddingBottom: "80px",
            color: "var(--Ac-1)",
            overflowY: "auto",
            boxSizing: "border-box"
        }}>
            <div style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                marginBottom: "30px"
            }}>
                <IoPersonCircleOutline size={80} color="var(--Ac-3)" />
                <h2 style={{ marginTop: "10px" }}>User Profile</h2>
                <p style={{ color: "var(--Ac-2)", fontSize: "0.9rem" }}>user@example.com</p>
            </div>

            <h3 style={{ marginBottom: "10px", fontSize: "1rem", color: "var(--Ac-2)" }}>Settings</h3>

            <div style={sectionStyle}>
                <ScalableElement as="div" style={itemStyle}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <IoSettingsOutline />
                        <span>Preferences</span>
                    </div>
                    <span>{">"}</span>
                </ScalableElement>

                <ScalableElement as="div" style={{ ...itemStyle, borderBottom: "none" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <IoLogOutOutline color="var(--Ec-1)" />
                        <span style={{ color: "var(--Ec-1)" }}>Log Out</span>
                    </div>
                </ScalableElement>
            </div>

            <div style={{
                marginTop: "auto",
                textAlign: "center",
                color: "var(--Ac-3)",
                fontSize: "0.8rem"
            }}>
                MoniMonitor v1.0.0
            </div>
        </div>
    );
};

export default Account;
