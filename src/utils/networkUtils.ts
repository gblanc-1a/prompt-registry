import axios, {
  AxiosRequestConfig,
  AxiosResponse,
} from 'axios';
import {
  Logger,
} from './logger';

/**
 * Network utility functions for Prompt Registry extension
 */
export class NetworkUtils {
  private static readonly logger = Logger.getInstance();

  /**
   * Check if an URL is accessible
   * @param url
   * @param timeout
   */
  public static async isUrlAccessible(url: string, timeout = 5000): Promise<boolean> {
    try {
      await axios.head(url, { timeout });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Download a file with progress tracking
   * @param url
   * @param onProgress
   * @param timeout
   */
  public static async downloadFile(
    url: string,
    onProgress?: (progress: number) => void,
    timeout = 300_000
  ): Promise<Buffer> {
    try {
      this.logger.debug(`Downloading file from: ${url}`);

      const response: AxiosResponse<ArrayBuffer> = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout,
        onDownloadProgress: (progressEvent) => {
          if (onProgress && progressEvent.total) {
            const progress = (progressEvent.loaded / progressEvent.total) * 100;
            onProgress(progress);
          }
        }
      });

      return Buffer.from(response.data);
    } catch (error) {
      this.logger.error(`Failed to download file from ${url}`, error as Error);
      throw error;
    }
  }

  /**
   * Make a GET request with retry logic
   * @param url
   * @param config
   * @param maxRetries
   * @param retryDelay
   */
  public static async getWithRetry<T>(
    url: string,
    config?: AxiosRequestConfig,
    maxRetries = 3,
    retryDelay = 1000
  ): Promise<AxiosResponse<T>> {
    let lastError: Error = new Error('No attempts made');

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await axios.get<T>(url, config);
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(`GET request failed (attempt ${attempt}/${maxRetries}): ${url}`, error as Error);

        if (attempt < maxRetries) {
          await this.delay(retryDelay * attempt);
        }
      }
    }

    throw lastError || new Error('All retry attempts failed');
  }

  /**
   * Check internet connectivity
   */
  public static async checkConnectivity(): Promise<boolean> {
    const testUrls = [
      'https://api.github.com',
      'https://www.google.com',
      'https://www.cloudflare.com'
    ];

    for (const url of testUrls) {
      if (await this.isUrlAccessible(url, 3000)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Validate URL format
   * @param url
   */
  public static isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Extract domain from URL
   * @param url
   */
  public static extractDomain(url: string): string | null {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch {
      return null;
    }
  }

  /**
   * Build URL with query parameters
   * @param baseUrl
   * @param params
   */
  public static buildUrl(baseUrl: string, params?: Record<string, string | number>): string {
    if (!params || Object.keys(params).length === 0) {
      return baseUrl;
    }

    const url = new URL(baseUrl);

    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }

    return url.toString();
  }

  /**
   * Get file size from URL without downloading
   * @param url
   */
  public static async getRemoteFileSize(url: string): Promise<number | null> {
    try {
      const response = await axios.head(url);
      const contentLength = response.headers['content-length'];
      return contentLength ? Number.parseInt(contentLength, 10) : null;
    } catch {
      return null;
    }
  }

  /**
   * Delay execution for specified milliseconds
   * @param ms
   */
  private static async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Format download speed
   * @param bytesPerSecond
   */
  public static formatSpeed(bytesPerSecond: number): string {
    const speeds = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    let i = 0;
    let speed = bytesPerSecond;

    while (speed >= 1024 && i < speeds.length - 1) {
      speed /= 1024;
      i++;
    }

    return `${Math.round(speed * 100) / 100} ${speeds[i]}`;
  }

  /**
   * Calculate ETA based on progress and speed
   * @param totalBytes
   * @param downloadedBytes
   * @param bytesPerSecond
   */
  public static calculateETA(
    totalBytes: number,
    downloadedBytes: number,
    bytesPerSecond: number
  ): string {
    if (bytesPerSecond === 0) {
      return 'Unknown';
    }

    const remainingBytes = totalBytes - downloadedBytes;
    const remainingSeconds = remainingBytes / bytesPerSecond;

    if (remainingSeconds < 60) {
      return `${Math.round(remainingSeconds)}s`;
    } else if (remainingSeconds < 3600) {
      return `${Math.round(remainingSeconds / 60)}m`;
    } else {
      return `${Math.round(remainingSeconds / 3600)}h`;
    }
  }
}
