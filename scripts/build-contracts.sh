#!/bin/bash

# Build script for CKB contracts
# This builds all 5 contracts for RISC-V target:
#   campaign, campaign-lock, pledge, pledge-lock, receipt

set -e

echo "Building CKB contracts..."

# Set the compiler for RISC-V target
export CC_riscv64imac_unknown_none_elf=riscv64-elf-gcc
# Archive ckb-std's C objects with the RISC-V ar. The host ar (e.g. macOS ranlib) can write an
# archive rustc won't bundle, which drops libc.o from the link and changes the code hash.
export AR_riscv64imac_unknown_none_elf=riscv64-elf-ar
# Enable B-extension sub-features for CKB VM v2 (data2 hashType)
export RUSTFLAGS="-C target-feature=+zba,+zbb,+zbc,+zbs,-a"

# Build Campaign contract
echo "Building Campaign contract..."
cd contracts/campaign
cargo build --release --target riscv64imac-unknown-none-elf
riscv64-elf-objcopy --strip-debug --strip-all target/riscv64imac-unknown-none-elf/release/campaign-contract
echo "✓ Campaign contract built and stripped successfully"

# Build Campaign-Lock contract
echo "Building Campaign-Lock contract..."
cd ../campaign-lock
cargo build --release --target riscv64imac-unknown-none-elf
riscv64-elf-objcopy --strip-debug --strip-all target/riscv64imac-unknown-none-elf/release/campaign-lock
echo "✓ Campaign-Lock contract built and stripped successfully"

# Build Pledge contract
echo "Building Pledge contract..."
cd ../pledge
cargo build --release --target riscv64imac-unknown-none-elf
riscv64-elf-objcopy --strip-debug --strip-all target/riscv64imac-unknown-none-elf/release/pledge
echo "✓ Pledge contract built and stripped successfully"

# Build Pledge-Lock contract
echo "Building Pledge-Lock contract..."
cd ../pledge-lock
cargo build --release --target riscv64imac-unknown-none-elf
riscv64-elf-objcopy --strip-debug --strip-all target/riscv64imac-unknown-none-elf/release/pledge-lock
echo "✓ Pledge-Lock contract built and stripped successfully"

# Build Receipt contract
echo "Building Receipt contract..."
cd ../receipt
cargo build --release --target riscv64imac-unknown-none-elf
riscv64-elf-objcopy --strip-debug --strip-all target/riscv64imac-unknown-none-elf/release/receipt
echo "✓ Receipt contract built and stripped successfully"

cd ../..

echo ""
echo "Build complete!"
echo "Campaign binary:      contracts/campaign/target/riscv64imac-unknown-none-elf/release/campaign-contract"
echo "Campaign-Lock binary: contracts/campaign-lock/target/riscv64imac-unknown-none-elf/release/campaign-lock"
echo "Pledge binary:       contracts/pledge/target/riscv64imac-unknown-none-elf/release/pledge"
echo "Pledge-Lock binary:  contracts/pledge-lock/target/riscv64imac-unknown-none-elf/release/pledge-lock"
echo "Receipt binary:      contracts/receipt/target/riscv64imac-unknown-none-elf/release/receipt"
