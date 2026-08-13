import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AuthProvider, useAuth } from "./AuthContext";

const CurrentProfile = () => {
    const { user } = useAuth();
    return <span>{user?.profilePhotoUrl || "no-photo"}</span>;
};

beforeEach(() => {
    const values = new Map();
    Object.defineProperty(window, "localStorage", {
        configurable: true,
        value: {
            clear: () => values.clear(),
            getItem: (key) => values.has(key) ? values.get(key) : null,
            removeItem: (key) => values.delete(key),
            setItem: (key, value) => values.set(key, String(value)),
        },
    });
    window.localStorage.clear();
    window.localStorage.setItem("token", "saved-token");
    window.localStorage.setItem("username", "saeed");
    window.localStorage.setItem("userId", "app-user-id");
    window.Telegram = {
        WebApp: {
            initData: "signed-telegram-data",
            ready: vi.fn(),
            expand: vi.fn(),
        },
    };
});

afterEach(() => {
    vi.restoreAllMocks();
    delete window.Telegram;
    window.localStorage.clear();
});

test("refreshes and persists the Telegram profile photo for an existing session", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({
            accessToken: "refreshed-token",
            user: {
                id: "app-user-id",
                username: "saeed",
                profilePhotoUrl: "https://t.me/i/userpic/320/profile.jpg",
                joinedAt: "2026-08-12T12:00:00.000Z",
            },
        }),
    });

    render(
        <AuthProvider>
            <CurrentProfile />
        </AuthProvider>
    );

    expect(await screen.findByText("no-photo")).toBeInTheDocument();
    await waitFor(() => {
        expect(screen.getByText("https://t.me/i/userpic/320/profile.jpg")).toBeInTheDocument();
    });
    expect(window.localStorage.getItem("profilePhotoUrl")).toBe("https://t.me/i/userpic/320/profile.jpg");
    expect(window.localStorage.getItem("joinedAt")).toBe("2026-08-12T12:00:00.000Z");
    expect(window.localStorage.getItem("token")).toBe("refreshed-token");
});
