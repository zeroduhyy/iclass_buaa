import { Navigate, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import LoginStudentPage from "../pages/LoginStudentPage";
import LoginVpnPage from "../pages/LoginVpnPage";
import CalendarPage from "../pages/CalendarPage";
import { getToken } from "../utils/session";

const RequireAuth = ({ children }: { children: ReactNode }) => {
    const token = getToken();
    if (!token) {
        return <Navigate to="/login" replace />;
    }
    return children;
};

const AppRoutes = () => {
    return (
        <Routes>
            <Route path="/login" element={<LoginStudentPage />} />
            <Route path="/login/vpn" element={<LoginVpnPage />} />
            <Route
                path="/calendar"
                element={
                    <RequireAuth>
                        <CalendarPage />
                    </RequireAuth>
                }
            />
            <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
    );
};

export default AppRoutes;
