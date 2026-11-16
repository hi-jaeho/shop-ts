import axios from "axios";

// 서버 주소를 한 곳에 모아두고, 요청할 때 '/products' 부분만 적음
const api = axios.create({
    baseURL: import.meta.env.VITE_API_URL,
    withCredentials: true,
});

export default api;