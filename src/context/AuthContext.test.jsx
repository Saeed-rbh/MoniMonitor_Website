import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AuthProvider, useAuth } from "./AuthContext";

const CurrentProfile = () => {
    const { user } = useAuth();
    return <span>{user?.profilePhotoUrl || "no-photo"}</span>;
};

beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("token", "saved-token");
    localStorage.setItem("username", "saeed");
    localStorage.setItem("userId", "app-user-id");
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
    localStorage.clear();
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
    expect(localStorage.getItem("profilePhotoUrl")).toBe("https://t.me/i/userpic/320/profile.jpg");
    expect(localStorage.getItem("joinedAt")).toBe("2026-08-12T12:00:00.000Z");
    expect(localStorage.getItem("token")).toBe("refreshed-token");
});
