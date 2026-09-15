"""VCP-owned Daylist deployment; distinct receipts, secrets, ports and containers."""
import argparse
from pathlib import Path
from deploy import deploy

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('environment', choices=['stage', 'prod'])
    parser.add_argument('--candidate', type=Path, required=True)
    args = parser.parse_args()
    deploy(args.environment, args.candidate.resolve(), Path('/mnt/data/vcp-daylist'), 'daylist')
