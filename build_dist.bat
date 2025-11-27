@echo off
echo ========================================
echo   Moveset Customizer - Build for Distribution
echo ========================================
echo.

echo Choose build type:
echo   1. Installer (NSIS setup exe)
echo   2. Portable (single exe, no install needed)
echo   3. Directory (unpacked, for testing)
echo.

set /p choice="Enter choice (1-3): "

if "%choice%"=="1" (
    echo.
    echo Building installer...
    npm run dist
) else if "%choice%"=="2" (
    echo.
    echo Building portable exe...
    npm run dist:portable
) else if "%choice%"=="3" (
    echo.
    echo Building unpacked directory...
    npm run dist:dir
) else (
    echo Invalid choice. Exiting.
    pause
    exit /b 1
)

echo.
echo ========================================
echo   Build complete! Check the 'dist' folder
echo ========================================
pause

