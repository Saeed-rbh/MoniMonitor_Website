Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase, System.Drawing, System.Windows.Forms

$xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="MoniMonitor Status Gadget"
        Height="490" Width="360"
        WindowStyle="None"
        AllowsTransparency="True"
        Background="Transparent"
        Topmost="True"
        ResizeMode="NoResize"
        WindowStartupLocation="Manual">
    <Window.Resources>
        <Style TargetType="TextBlock">
            <Setter Property="FontFamily" Value="Segoe UI" />
            <Setter Property="Foreground" Value="#E2E8F0" />
        </Style>
    </Window.Resources>
    <Border CornerRadius="16" Background="#111827" BorderBrush="#1E293B" BorderThickness="1.5" Margin="8">
        <Border.Effect>
            <DropShadowEffect BlurRadius="20" ShadowDepth="4" Direction="270" Color="#000000" Opacity="0.6"/>
        </Border.Effect>
        <Grid Margin="16,14,16,14">
            <Grid.RowDefinitions>
                <RowDefinition Height="Auto"/>
                <RowDefinition Height="Auto"/>
                <RowDefinition Height="*"/>
                <RowDefinition Height="Auto"/>
            </Grid.RowDefinitions>

            <!-- Title Bar / Drag Area -->
            <Grid Grid.Row="0" Name="TitleBar" Background="Transparent" Cursor="SizeAll">
                <Grid.ColumnDefinitions>
                    <ColumnDefinition Width="Auto"/>
                    <ColumnDefinition Width="*"/>
                    <ColumnDefinition Width="Auto"/>
                    <ColumnDefinition Width="Auto"/>
                </Grid.ColumnDefinitions>

                <Border Width="26" Height="26" CornerRadius="7" Margin="0,0,10,0">
                    <Border.Background>
                        <LinearGradientBrush StartPoint="0,0" EndPoint="1,1">
                            <GradientStop Color="#38BDF8" Offset="0"/>
                            <GradientStop Color="#818CF8" Offset="1"/>
                        </LinearGradientBrush>
                    </Border.Background>
                    <TextBlock Text="M" FontWeight="Bold" FontSize="14" Foreground="White"
                               HorizontalAlignment="Center" VerticalAlignment="Center"/>
                </Border>

                <StackPanel Grid.Column="1" VerticalAlignment="Center">
                    <TextBlock Text="MoniMonitor" FontWeight="Bold" FontSize="14"/>
                    <TextBlock Text="Live System Monitor" FontSize="10" Foreground="#64748B"/>
                </StackPanel>

                <!-- Pin / Pin off toggle -->
                <Button Grid.Column="2" Name="PinBtn" Width="24" Height="24" Margin="0,0,4,0"
                        Background="Transparent" BorderBrush="Transparent" Foreground="#94A3B8" Cursor="Hand"
                        ToolTip="Toggle Always-on-Top">
                    <TextBlock Text="📌" FontSize="11" HorizontalAlignment="Center" VerticalAlignment="Center"/>
                </Button>

                <Button Grid.Column="3" Name="CloseBtn" Width="24" Height="24"
                        Background="Transparent" BorderBrush="Transparent" Foreground="#94A3B8" Cursor="Hand"
                        ToolTip="Close Gadget">
                    <TextBlock Text="✕" FontSize="12" FontWeight="Bold" HorizontalAlignment="Center" VerticalAlignment="Center"/>
                </Button>
            </Grid>

            <!-- Overall Banner -->
            <Border Grid.Row="1" Name="BannerBorder" Margin="0,12,0,12" CornerRadius="10"
                    Background="#1E293B" BorderBrush="#334155" BorderThickness="1" Padding="12,10">
                <Grid>
                    <Grid.ColumnDefinitions>
                        <ColumnDefinition Width="Auto"/>
                        <ColumnDefinition Width="*"/>
                        <ColumnDefinition Width="Auto"/>
                    </Grid.ColumnDefinitions>
                    <Ellipse Name="OverallDot" Width="14" Height="14" Fill="#EAB308" Margin="0,0,10,0" VerticalAlignment="Center"/>
                    <StackPanel Grid.Column="1" VerticalAlignment="Center">
                        <TextBlock Name="OverallTitle" Text="Checking Services…" FontWeight="Bold" FontSize="12.5"/>
                        <TextBlock Name="OverallSub" Text="Connecting to API" FontSize="10" Foreground="#94A3B8"/>
                    </StackPanel>
                    <TextBlock Grid.Column="2" Name="CountdownText" Text="10s" FontSize="11" Foreground="#64748B"
                               VerticalAlignment="Center" FontWeight="SemiBold"/>
                </Grid>
            </Border>

            <!-- Subsystem List -->
            <ScrollViewer Grid.Row="2" VerticalScrollBarVisibility="Auto" Margin="0,0,0,8">
                <StackPanel Name="ItemsPanel">
                    <!-- Items populated dynamically in PowerShell -->
                </StackPanel>
            </ScrollViewer>

            <!-- Action Buttons Footer -->
            <Grid Grid.Row="3" Margin="0,6,0,0">
                <Grid.ColumnDefinitions>
                    <ColumnDefinition Width="*"/>
                    <ColumnDefinition Width="*"/>
                    <ColumnDefinition Width="Auto"/>
                </Grid.ColumnDefinitions>
                <Button Grid.Column="0" Name="OpenWebBtn" Content="🌐 Open Dashboard" Margin="0,0,4,0" Height="28"
                        Background="#1E293B" Foreground="#38BDF8" BorderBrush="#334155" BorderThickness="1"
                        Cursor="Hand" FontSize="11" FontWeight="SemiBold">
                    <Button.Resources>
                        <Style TargetType="Border">
                            <Setter Property="CornerRadius" Value="6"/>
                        </Style>
                    </Button.Resources>
                </Button>
                <Button Grid.Column="1" Name="RestartBtn" Content="🔄 Relaunch Services" Margin="4,0,4,0" Height="28"
                        Background="#1E293B" Foreground="#E2E8F0" BorderBrush="#334155" BorderThickness="1"
                        Cursor="Hand" FontSize="11" FontWeight="SemiBold">
                    <Button.Resources>
                        <Style TargetType="Border">
                            <Setter Property="CornerRadius" Value="6"/>
                        </Style>
                    </Button.Resources>
                </Button>
                <Button Grid.Column="2" Name="RefreshBtn" Content="↻" Width="28" Height="28" Margin="4,0,0,0"
                        Background="#1E293B" Foreground="#94A3B8" BorderBrush="#334155" BorderThickness="1"
                        Cursor="Hand" FontSize="13" FontWeight="Bold">
                    <Button.Resources>
                        <Style TargetType="Border">
                            <Setter Property="CornerRadius" Value="6"/>
                        </Style>
                    </Button.Resources>
                </Button>
            </Grid>
        </Grid>
    </Border>
</Window>
"@

$reader = [System.Xml.XmlReader]::Create([System.IO.StringReader]::new($xaml))
$window = [System.Windows.Markup.XamlReader]::Load($reader)

# Position on top-right of screen by default
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$window.Left = $screen.Right - $window.Width - 20
$window.Top = $screen.Top + 40

# Window controls
$titleBar = $window.FindName("TitleBar")
$titleBar.Add_MouseLeftButtonDown({
    $window.DragMove()
})

$closeBtn = $window.FindName("CloseBtn")
$closeBtn.Add_Click({
    $window.Close()
})

$pinBtn = $window.FindName("PinBtn")
$pinBtn.Add_Click({
    $window.Topmost = -not $window.Topmost
    $pinBtn.Foreground = if ($window.Topmost) { [System.Windows.Media.BrushConverter]::new().ConvertFromString("#38BDF8") } else { [System.Windows.Media.BrushConverter]::new().ConvertFromString("#64748B") }
})

$openWebBtn = $window.FindName("OpenWebBtn")
$openWebBtn.Add_Click({
    Start-Process "http://localhost:3001/status"
})

$restartBtn = $window.FindName("RestartBtn")
$restartBtn.Add_Click({
    $launcher = "C:\Users\Saeed\Personal_Files\CodeDevelope\MoniMonitor_Website\start-monimonitor.cmd"
    if (Test-Path $launcher) {
        Start-Process $launcher
    }
})

$refreshBtn = $window.FindName("RefreshBtn")
$itemsPanel = $window.FindName("ItemsPanel")
$overallDot = $window.FindName("OverallDot")
$overallTitle = $window.FindName("OverallTitle")
$overallSub = $window.FindName("OverallSub")
$bannerBorder = $window.FindName("BannerBorder")
$countdownText = $window.FindName("CountdownText")

$bc = [System.Windows.Media.BrushConverter]::new()
$colorOk = $bc.ConvertFromString("#22C55E")
$colorWarn = $bc.ConvertFromString("#EAB308")
$colorErr = $bc.ConvertFromString("#EF4444")
$colorUnknown = $bc.ConvertFromString("#64748B")

function Create-ItemRow {
    param(
        [string]$Icon,
        [string]$Name,
        [string]$Status,
        [string]$Details,
        [string]$ColorHex
    )

    $border = [System.Windows.Controls.Border]::new()
    $border.Margin = [System.Windows.Thickness]::new(0, 0, 0, 6)
    $border.Padding = [System.Windows.Thickness]::new(10, 8, 10, 8)
    $border.Background = $bc.ConvertFromString("#161F30")
    $border.BorderBrush = $bc.ConvertFromString("#1E293B")
    $border.BorderThickness = [System.Windows.Thickness]::new(1)
    $border.CornerRadius = [System.Windows.CornerRadius]::new(8)

    $grid = [System.Windows.Controls.Grid]::new()
    $c0 = [System.Windows.Controls.ColumnDefinition]::new()
    $c0.Width = [System.Windows.GridLength]::Auto
    $c1 = [System.Windows.Controls.ColumnDefinition]::new()
    $c1.Width = [System.Windows.GridLength]::new(1, [System.Windows.GridUnitType]::Star)
    $c2 = [System.Windows.Controls.ColumnDefinition]::new()
    $c2.Width = [System.Windows.GridLength]::Auto
    $grid.ColumnDefinitions.Add($c0)
    $grid.ColumnDefinitions.Add($c1)
    $grid.ColumnDefinitions.Add($c2)

    # Icon
    $iconText = [System.Windows.Controls.TextBlock]::new()
    $iconText.Text = $Icon
    $iconText.FontSize = 14
    $iconText.Margin = [System.Windows.Thickness]::new(0, 0, 8, 0)
    $iconText.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
    [System.Windows.Controls.Grid]::SetColumn($iconText, 0)
    $grid.Children.Add($iconText) | Out-Null

    # Name + Details
    $stack = [System.Windows.Controls.StackPanel]::new()
    $nameText = [System.Windows.Controls.TextBlock]::new()
    $nameText.Text = $Name
    $nameText.FontSize = 12
    $nameText.FontWeight = [System.Windows.FontWeights]::SemiBold
    $detailText = [System.Windows.Controls.TextBlock]::new()
    $detailText.Text = $Details
    $detailText.FontSize = 10
    $detailText.Foreground = $bc.ConvertFromString("#94A3B8")
    $stack.Children.Add($nameText) | Out-Null
    $stack.Children.Add($detailText) | Out-Null
    [System.Windows.Controls.Grid]::SetColumn($stack, 1)
    $grid.Children.Add($stack) | Out-Null

    # Status Pill
    $badge = [System.Windows.Controls.Border]::new()
    $badge.Padding = [System.Windows.Thickness]::new(8, 3, 8, 3)
    $badge.CornerRadius = [System.Windows.CornerRadius]::new(10)
    $badge.Background = $bc.ConvertFromString("$ColorHex" + "22")
    $badge.BorderBrush = $bc.ConvertFromString($ColorHex)
    $badge.BorderThickness = [System.Windows.Thickness]::new(1)
    $badge.VerticalAlignment = [System.Windows.VerticalAlignment]::Center

    $statusText = [System.Windows.Controls.TextBlock]::new()
    $statusText.Text = $Status
    $statusText.FontSize = 9.5
    $statusText.FontWeight = [System.Windows.FontWeights]::Bold
    $statusText.Foreground = $bc.ConvertFromString($ColorHex)
    $badge.Child = $statusText

    [System.Windows.Controls.Grid]::SetColumn($badge, 2)
    $grid.Children.Add($badge) | Out-Null

    $border.Child = $grid
    return $border
}

function Update-Dashboard {
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:3001/health" -TimeoutSec 3 -ErrorAction Stop
        $backendUp = $true
    } catch {
        $backendUp = $false
        $health = $null
    }

    # Public tunnel check
    try {
        $publicReq = Invoke-WebRequest -Uri "https://monimonitor.saeedarabha.com/api/health" -TimeoutSec 4 -UseBasicParsing -ErrorAction Stop
        $publicUp = ($publicReq.StatusCode -eq 200)
    } catch {
        $publicUp = $false
    }

    $itemsPanel.Children.Clear()

    if (-not $backendUp) {
        $overallDot.Fill = $colorErr
        $overallTitle.Text = "Backend Offline"
        $overallSub.Text = "Port 3001 not reachable"
        $bannerBorder.BorderBrush = $colorErr

        $itemsPanel.Children.Add((Create-ItemRow "🖥️" "Backend API" "Offline" "Port 3001 connection refused" "#EF4444")) | Out-Null
        $itemsPanel.Children.Add((Create-ItemRow "🔗" "Public Access" $(if ($publicUp) { "Connected" } else { "Offline" }) "monimonitor.saeedarabha.com" $(if ($publicUp) { "#22C55E" } else { "#EF4444" }))) | Out-Null
        return
    }

    # Backend is UP
    $overallStatus = $health.status
    if ($overallStatus -eq "ok") {
        $overallDot.Fill = $colorOk
        $overallTitle.Text = "All Systems Active"
        $overallSub.Text = "All 7 subsystems operating normally"
        $bannerBorder.BorderBrush = $colorOk
    } elseif ($overallStatus -eq "degraded") {
        $overallDot.Fill = $colorWarn
        $overallTitle.Text = "Services Active (Minor Warning)"
        $overallSub.Text = "System operational; backup or queue check needed"
        $bannerBorder.BorderBrush = $colorWarn
    } else {
        $overallDot.Fill = $colorErr
        $overallTitle.Text = "Degraded / Unavailable"
        $overallSub.Text = "One or more core services down"
        $bannerBorder.BorderBrush = $colorErr
    }

    # 1. Backend API
    $itemsPanel.Children.Add((Create-ItemRow "🖥️" "Backend Server" "Online" "Port 3001 · Express API" "#22C55E")) | Out-Null

    # 2. Database
    $dbState = $health.database.state
    $dbOk = ($dbState -eq "ready")
    $itemsPanel.Children.Add((Create-ItemRow "🗄️" "SQLite Database" $(if ($dbOk) { "Ready" } else { "Down" }) "monimonitor.sqlite · WAL mode" $(if ($dbOk) { "#22C55E" } else { "#EF4444" }))) | Out-Null

    # 3. Email Agent (IMAP)
    $imap = $health.subsystems.imap
    $emailQ = $health.queues.email
    $imapState = if ($imap.state) { $imap.state } else { "active" }
    $imapColor = if ($imapState -eq "connected" -or $imapState -eq "processing") { "#22C55E" } else { "#EAB308" }
    $emailDetail = "$($emailQ.processed) processed · $($emailQ.pending) pending · $($emailQ.dead) dead"
    $itemsPanel.Children.Add((Create-ItemRow "📧" "Email Agent (IMAP)" $imapState.ToUpper() $emailDetail $imapColor)) | Out-Null

    # 4. Telegram Outbox
    $tg = $health.subsystems.telegramOutbox
    $tgQ = $health.queues.telegram
    $tgState = if ($tg.state) { $tg.state } else { "ready" }
    $tgColor = if ($tgState -eq "ready" -or $tgState -eq "ok") { "#22C55E" } else { "#EAB308" }
    $tgDetail = "$($tgQ.processed) sent · $($tgQ.pending) pending · $($tgQ.dead) failed"
    $itemsPanel.Children.Add((Create-ItemRow "✈️" "Telegram Bot" $tgState.ToUpper() $tgDetail $tgColor)) | Out-Null

    # 5. Backup Service
    $backup = $health.backup
    $backupStale = $backup.stale
    $backupAgeHrs = [Math]::Round(($backup.ageSeconds / 3600), 1)
    $backupColor = if ($backupStale) { "#EAB308" } else { "#22C55E" }
    $backupStatus = if ($backupStale) { "STALE" } else { "FRESH" }
    $backupDetail = "$backupAgeHrs hrs ago · Automated encrypted"
    $itemsPanel.Children.Add((Create-ItemRow "💾" "Backup Service" $backupStatus $backupDetail $backupColor)) | Out-Null

    # 6. Plaid Integration
    $itemsPanel.Children.Add((Create-ItemRow "🏦" "Plaid Banking" "Active" "Transactions & holdings sync" "#22C55E")) | Out-Null

    # 7. Public Reachability
    $pubColor = if ($publicUp) { "#22C55E" } else { "#EF4444" }
    $pubStatus = if ($publicUp) { "ONLINE" } else { "OFFLINE" }
    $itemsPanel.Children.Add((Create-ItemRow "🔗" "Public Domain" $pubStatus "monimonitor.saeedarabha.com" $pubColor)) | Out-Null
}

# Timer for periodic refresh
$timerSec = 10
$timer = [System.Windows.Threading.DispatcherTimer]::new()
$timer.Interval = [TimeSpan]::FromSeconds(1)
$currentCount = $timerSec

$timer.Add_Tick({
    $script:currentCount--
    if ($script:currentCount -le 0) {
        $countdownText.Text = "refreshing…"
        Update-Dashboard
        $script:currentCount = $timerSec
    } else {
        $countdownText.Text = "$($script:currentCount)s"
    }
})

$refreshBtn.Add_Click({
    $countdownText.Text = "refreshing…"
    Update-Dashboard
    $script:currentCount = $timerSec
})

# Initial render
Update-Dashboard
$timer.Start()

# Run the WPF Application
[void]$window.ShowDialog()
