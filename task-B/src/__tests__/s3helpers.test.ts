/// <reference types="jest" />
import { uploadBlobToS3, downloadBlobFromS3 } from '../index';

global.fetch = jest.fn();

describe('S3 Helpers', () => {
  beforeEach(() => {
    (fetch as jest.Mock).mockReset();
  });

  describe('uploadBlobToS3', () => {
    it('should upload blob with PUT and correct headers', async () => {
      (fetch as jest.Mock).mockResolvedValue({ ok: true });
      const blob = new Blob(['test'], { type: 'application/octet-stream' });
      await uploadBlobToS3(blob, 'https://example.com/presigned-url');
      expect(fetch).toHaveBeenCalledWith('https://example.com/presigned-url', {
        method: 'PUT',
        body: blob,
        headers: { 'Content-Type': 'application/octet-stream' },
      });
    });

    it('should throw if upload fails', async () => {
      (fetch as jest.Mock).mockResolvedValue({ ok: false, statusText: 'Forbidden' });
      const blob = new Blob(['test'], { type: 'application/octet-stream' });
      await expect(uploadBlobToS3(blob, 'https://example.com/presigned-url')).rejects.toThrow('Upload to S3 failed: Forbidden');
    });
  });

  describe('downloadBlobFromS3', () => {
    it('should download blob with GET', async () => {
      const mockBlob = new Blob(['data']);
      (fetch as jest.Mock).mockResolvedValue({ ok: true, blob: () => Promise.resolve(mockBlob) });
      const result = await downloadBlobFromS3('https://example.com/presigned-url');
      expect(fetch).toHaveBeenCalledWith('https://example.com/presigned-url');
      expect(result).toBe(mockBlob);
    });

    it('should throw if download fails', async () => {
      (fetch as jest.Mock).mockResolvedValue({ ok: false, statusText: 'Not Found' });
      await expect(downloadBlobFromS3('https://example.com/presigned-url')).rejects.toThrow('Download from S3 failed: Not Found');
    });
  });
}); 