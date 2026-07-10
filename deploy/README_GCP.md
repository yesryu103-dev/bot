# GCP deploy

Use this to run the Telegram bot 24/7 on a Google Cloud VM.

## 1. Create VM

In Google Cloud Console:

- Compute Engine -> VM instances -> Create instance
- Name: `wallet-bot`
- Region: closest to you
- Machine: `e2-micro` or `e2-small`
- Boot disk: Ubuntu 22.04 LTS or Ubuntu 24.04 LTS
- Firewall HTTP/HTTPS: not needed

## 2. SSH into VM

Use the browser SSH button once, then run:

```bash
sudo apt-get update
sudo apt-get install -y unzip rsync
```

## 3. Deploy from Windows

From this project folder on your PC:

```powershell
.\deploy\deploy-to-vm.ps1 -HostName "VM_EXTERNAL_IP" -User "VM_USER"
```

If SSH is not configured on Windows yet, use Google Cloud Console SSH and upload the zip manually.

## 4. Edit server env

On the VM:

```bash
sudo nano /opt/wallet-bot/.env
sudo systemctl restart wallet-bot
```

Keep secrets safe:

```bash
sudo chmod 600 /opt/wallet-bot/.env
```

## 5. Manage bot

```bash
sudo systemctl status wallet-bot
sudo journalctl -u wallet-bot -f
sudo systemctl restart wallet-bot
sudo systemctl stop wallet-bot
```

The service auto-starts after VM reboot.
