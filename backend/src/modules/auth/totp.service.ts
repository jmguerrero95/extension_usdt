import QRCode from 'qrcode';
import { generateSecret, generateURI, verifySync } from 'otplib';

export class TotpService {
  public constructor(private readonly issuer: string) {}

  public generateSecret(): string {
    return generateSecret();
  }

  public verify(secret: string, token: string): boolean {
    return verifySync({
      secret,
      token,
    }).valid;
  }

  public buildOtpAuthUrl(email: string, secret: string): string {
    return generateURI({
      issuer: this.issuer,
      label: email,
      secret,
    });
  }

  public async buildQrDataUrl(email: string, secret: string): Promise<string> {
    return QRCode.toDataURL(this.buildOtpAuthUrl(email, secret), {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 240,
    });
  }
}
