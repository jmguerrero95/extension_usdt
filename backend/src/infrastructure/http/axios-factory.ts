import axios, { type AxiosInstance } from 'axios';

export const createAxiosClient = (baseURL: string, timeoutMs: number): AxiosInstance =>
  axios.create({
    baseURL,
    timeout: timeoutMs,
    validateStatus: () => true,
  });
