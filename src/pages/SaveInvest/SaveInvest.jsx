import React, { useEffect, useState } from 'react';
import { useTransactions } from '../../context/TransactionContext';
import { useNavigate } from 'react-router-dom';
import {
    createInvestmentAccountAPI,
    deleteInvestmentAccountAPI,
    deleteInvestmentHoldingAPI,
    getPortfolioAPI,
    saveInvestmentHoldingAPI,
    updateInvestmentAccountAPI,
} from '../../services/apiService';

const accountTypes = ['Chequing', 'Savings', 'Credit Card', 'TFSA', 'RRSP', 'Brokerage', '401(k)', 'IRA', 'Other'];
const emptyAccount = { name: '', institution: '', accountType: 'Savings', cash: '', currency: 'USD' };
const emptyHolding = { symbol: '', name: '', quantity: '', averageCost: '', price: '' };
const toMinor = (value) => Math.round(Number(value || 0) * 100);
const money = (minor, currency = 'USD') => new Intl.NumberFormat(undefined, {
    style: 'currency', currency, maximumFractionDigits: 2,
}).format(Number(minor || 0) / 100);

const unitMoney = (micros, currency = 'USD') => new Intl.NumberFormat(undefined, {
    style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 4,
}).format(Number(micros || 0) / 1000000);
const decimalInput = (micros, minor) =>
    ((Number.isSafeInteger(micros) ? micros / 1000000 : Number(minor || 0) / 100).toFixed(4)).replace(/0+$/, '').replace(/\.$/, '');
const styles = {
    page: { width: '100%', maxWidth: 'var(--app-max-width)', margin: '0 auto', padding: '16px', overflowY: 'auto', color: 'var(--Ac-1)', boxSizing: 'border-box' },
    card: { background: 'linear-gradient(150deg, var(--Ac-4), var(--Ec-4))', border: '1px solid var(--Bc-3)', borderRadius: '18px', padding: '16px', marginBottom: '14px' },
    field: { width: '100%', boxSizing: 'border-box', padding: '10px', borderRadius: '10px', border: '1px solid var(--Bc-3)', background: 'var(--Ec-4)', color: 'var(--Ac-1)' },
    grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: '8px' },
    row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' },
    secondary: { color: 'var(--Ac-2)', fontSize: '.86rem' },
    button: { border: '1px solid var(--Bc-3)', borderRadius: '10px', padding: '9px 12px', cursor: 'pointer' },
};

const AccountCard = ({ account, onRefresh, setStatus }) => {
    const isCreditCard = account.accountType === 'Credit Card';
    const canHoldInvestments = !['Chequing', 'Credit Card'].includes(account.accountType);
    const [cash, setCash] = useState((account.cashMinor / 100).toFixed(2));
    const [holding, setHolding] = useState(emptyHolding);

    useEffect(() => setCash((account.cashMinor / 100).toFixed(2)), [account.cashMinor]);

    const saveCash = async () => {
        const cashMinor = toMinor(cash);
        if (!Number.isSafeInteger(cashMinor) || cashMinor < 0) return setStatus('Enter a valid cash balance.');
        if (!await updateInvestmentAccountAPI(account.id, { cashMinor })) return setStatus('Could not update the cash balance.');
        setStatus('Cash balance updated.');
        onRefresh();
    };

    const saveHolding = async (event) => {
        event.preventDefault();
        const quantity = Number(holding.quantity);
        const averageCostMinor = toMinor(holding.averageCost);
        const priceMinor = toMinor(holding.price);
        const averageCostMicros = Math.round(Number(holding.averageCost || 0) * 1000000);
        const priceMicros = Math.round(Number(holding.price || 0) * 1000000);
        if (!holding.symbol.trim() || !Number.isFinite(quantity) || quantity < 0 ||
            !Number.isSafeInteger(averageCostMinor) || averageCostMinor < 0 ||
            !Number.isSafeInteger(priceMinor) || priceMinor < 0 ||
            !Number.isSafeInteger(averageCostMicros) || averageCostMicros < 0 ||
            !Number.isSafeInteger(priceMicros) || priceMicros < 0) {
            return setStatus('Enter a symbol, quantity, cost, and current price.');
        }
        const saved = await saveInvestmentHoldingAPI(account.id, {
            symbol: holding.symbol.trim().toUpperCase(),
            name: holding.name.trim() || null,
            quantity,
            averageCostMinor,
            priceMinor,
            averageCostMicros,
            priceMicros,
            currency: account.currency,
        });
        if (!saved) return setStatus('Could not save the holding.');
        setHolding(emptyHolding);
        setStatus('Holding saved. Entering the same symbol updates it.');
        onRefresh();
    };

    const editHolding = (item) => setHolding({
        symbol: item.symbol,
        name: item.name || '',
        quantity: String(item.quantity),
        averageCost: decimalInput(item.averageCostMicros, item.averageCostMinor),
        price: decimalInput(item.priceMicros, item.priceMinor),
    });

    const cashVal = Number(account.cashMinor || 0);
    const holdingsVal = Number(account.holdingsValueMinor || 0);
    const totalVal = cashVal + holdingsVal;
    const cashShare = totalVal > 0 ? (cashVal / totalVal) * 100 : (cashVal > 0 ? 100 : 0);
    const holdingsShare = totalVal > 0 ? (holdingsVal / totalVal) * 100 : (holdingsVal > 0 ? 100 : 0);

    return <section style={styles.card}>
        <div style={styles.row}>
            <div>
                <h2 style={{ margin: 0, fontSize: '1.08rem' }}>{account.name}</h2>
                <span style={styles.secondary}>{account.institution || 'Independent'} · {account.accountType}</span>
            </div>
            <strong style={{ fontSize: '1.15rem', color: isCreditCard ? 'var(--Gc-2)' : undefined }}>
                {isCreditCard ? money(account.cashMinor, account.currency) : money(account.totalValueMinor, account.currency)}
            </strong>
        </div>

        <div style={{ ...styles.grid, marginTop: '14px' }}>
            <div><span style={styles.secondary}>{isCreditCard ? 'Balance owed' : 'Cash balance'}</span><strong style={{ display: 'block' }}>{money(account.cashMinor, account.currency)} {canHoldInvestments && <small style={styles.secondary}>({cashShare.toFixed(1)}%)</small>}</strong></div>
            {canHoldInvestments && <div><span style={styles.secondary}>Holdings value</span><strong style={{ display: 'block' }}>{money(account.holdingsValueMinor, account.currency)} <small style={styles.secondary}>({holdingsShare.toFixed(1)}%)</small></strong></div>}
            {canHoldInvestments && <div><span style={styles.secondary}>Stock gain/loss</span><strong style={{ display: 'block', color: account.gainLossMinor >= 0 ? 'var(--Fc-1)' : 'var(--Gc-2)' }}>{account.gainLossMinor >= 0 ? '+' : ''}{money(account.gainLossMinor, account.currency)}</strong></div>}
        </div>

        {canHoldInvestments && (
            <div style={{ marginTop: '10px' }}>
                <div style={{ display: 'flex', width: '100%', height: '6px', borderRadius: '999px', overflow: 'hidden', background: 'var(--Ac-4)' }}>
                    <span style={{ width: `${cashShare}%`, background: 'linear-gradient(90deg, #4ade80, #22c55e)' }} title={`Cash: ${cashShare.toFixed(1)}%`} />
                    <span style={{ width: `${holdingsShare}%`, background: 'linear-gradient(90deg, var(--Bc-1), #b48cdc)' }} title={`Holdings: ${holdingsShare.toFixed(1)}%`} />
                </div>
            </div>
        )}

        <div style={{ ...styles.row, marginTop: '14px', alignItems: 'end' }}>
            <label style={{ flex: 1 }}><span style={styles.secondary}>Available cash</span><input aria-label={`${account.name} cash balance`} type='number' min='0' step='0.01' value={cash} onChange={(event) => setCash(event.target.value)} style={styles.field} /></label>
            <button type='button' onClick={saveCash} style={styles.button}>Update cash</button>
        </div>

        {canHoldInvestments && <div style={{ marginTop: '16px' }}>
            <h3 style={{ fontSize: '.95rem', marginBottom: '8px' }}>Holdings</h3>
            {account.holdings.length ? account.holdings.map((item) => {
                const itemPriceMicros = Number.isSafeInteger(item.priceMicros) ? item.priceMicros : item.priceMinor * 10000;
                const value = Math.round(item.quantity * itemPriceMicros / 10000);
                const updated = new Date(item.updatedAt).toLocaleDateString();
                return <div key={item.id} style={{ ...styles.row, borderTop: '1px solid var(--Bc-4)', padding: '10px 0' }}>
                    <div style={{ minWidth: 0 }}><strong>{item.symbol}</strong>{item.name && <span style={styles.secondary}> · {item.name}</span>}<div style={styles.secondary}>{Number(Number(item.quantity || 0).toFixed(4))} shares × {unitMoney(itemPriceMicros, item.currency)} · Updated {updated}</div></div>
                    <div style={{ textAlign: 'right' }}><strong>{money(value, item.currency)}</strong><div><button type='button' onClick={() => editHolding(item)} style={{ ...styles.button, padding: '4px 7px' }}>Edit</button> <button type='button' onClick={async () => {
                        if (window.confirm(`Remove ${item.symbol} from ${account.name}?`) && await deleteInvestmentHoldingAPI(account.id, item.id)) {
                            setStatus('Holding removed.'); onRefresh();
                        }
                    }} style={{ ...styles.button, padding: '4px 7px' }}>Remove</button></div></div>
                </div>;
            }) : <p style={styles.secondary}>No stocks in this account. It can remain cash-only.</p>}
        </div>}

        {canHoldInvestments && <form onSubmit={saveHolding} style={{ marginTop: '10px' }}>
            <div style={styles.grid}>
                <input aria-label='Stock symbol' placeholder='Symbol (XEQT)' value={holding.symbol} onChange={(event) => setHolding({ ...holding, symbol: event.target.value })} style={styles.field} maxLength='15' required />
                <input aria-label='Holding name' placeholder='Name (optional)' value={holding.name} onChange={(event) => setHolding({ ...holding, name: event.target.value })} style={styles.field} maxLength='120' />
                <input aria-label='Share quantity' type='number' min='0' step='any' placeholder='Shares' value={holding.quantity} onChange={(event) => setHolding({ ...holding, quantity: event.target.value })} style={styles.field} required />
                <input aria-label='Average cost per share' type='number' min='0' step='0.0001' placeholder='Avg cost/share' value={holding.averageCost} onChange={(event) => setHolding({ ...holding, averageCost: event.target.value })} style={styles.field} required />
                <input aria-label='Current price per share' type='number' min='0' step='0.0001' placeholder='Current price/share' value={holding.price} onChange={(event) => setHolding({ ...holding, price: event.target.value })} style={styles.field} required />
            </div>
            <div style={{ ...styles.row, marginTop: '8px' }}>
                <span style={styles.secondary}>Prices are manual and show when they were last updated.</span>
                <button type='submit' style={styles.button}>{account.holdings.some((item) => item.symbol === holding.symbol.trim().toUpperCase()) ? 'Update holding' : 'Add holding'}</button>
            </div>
        </form>}

        <div style={{ textAlign: 'right', marginTop: '12px' }}><button type='button' onClick={async () => {
            if (window.confirm(`Delete ${account.name} and all of its holdings?`) && await deleteInvestmentAccountAPI(account.id)) {
                setStatus('Account deleted.'); onRefresh();
            }
        }} style={{ ...styles.button, color: 'var(--Gc-2)' }}>Delete account</button></div>
    </section>;
};

const SaveInvest = () => {
    const { mainSelected } = useTransactions();
    const navigate = useNavigate();
    const [portfolio, setPortfolio] = useState(null);
    const [account, setAccount] = useState(emptyAccount);
    const [showForm, setShowForm] = useState(false);
    const [status, setStatus] = useState('');

    const load = async () => setPortfolio(await getPortfolioAPI());
    useEffect(() => { load(); }, []);

    const addAccount = async (event) => {
        event.preventDefault();
        const cashMinor = toMinor(account.cash);
        if (!account.name.trim() || !Number.isSafeInteger(cashMinor) || cashMinor < 0) return setStatus('Enter an account name and valid cash balance.');
        const saved = await createInvestmentAccountAPI({
            name: account.name.trim(), institution: account.institution.trim() || null,
            accountType: account.accountType, currency: account.currency, cashMinor,
        });
        if (!saved) return setStatus('Could not create the account.');
        setAccount(emptyAccount); setShowForm(false); setStatus('Account created.'); load();
    };

    if (!portfolio) return <main style={styles.page}>Loading portfolio…</main>;

    return <main style={styles.page}>
        <div style={{ ...styles.row, alignItems: 'start', flexWrap: 'wrap', marginBottom: '14px' }}>
            <div><h1 style={{ fontSize: '1.35rem', margin: '4px 0' }}>Save & Invest</h1><p style={{ ...styles.secondary, margin: 0 }}>Current account value, separate from contributions.</p></div>
            <div style={{ ...styles.row, gap: '6px', marginLeft: 'auto' }}>
                <button type='button' onClick={() => navigate('/Accounts')} style={styles.button}>Overview</button>
                <button type='button' onClick={() => setShowForm((value) => !value)} style={styles.button}>{showForm ? 'Cancel' : '+ Account'}</button>
            </div>
        </div>
        {status && <p role='status' style={{ color: 'var(--Fc-1)' }}>{status}</p>}

        <section style={{ ...styles.card, background: 'linear-gradient(135deg, var(--Bc-4), var(--Ac-4))' }}>
            <span style={styles.secondary}>Net account value</span>
            <h2 style={{ fontSize: '2rem', margin: '3px 0 12px' }}>{money(portfolio.totalValueMinor, portfolio.accounts[0]?.currency || 'USD')}</h2>
            <div style={styles.grid}>
                <div><span style={styles.secondary}>Cash</span><strong style={{ display: 'block' }}>{money(portfolio.totalCashMinor)}</strong></div>
                <div><span style={styles.secondary}>Stocks</span><strong style={{ display: 'block' }}>{money(portfolio.holdingsValueMinor)}</strong></div>
                <div><span style={styles.secondary}>Credit card debt</span><strong style={{ display: 'block', color: 'var(--Gc-2)' }}>{money(portfolio.totalLiabilitiesMinor)}</strong></div>
                <div><span style={styles.secondary}>This month contributed</span><strong style={{ display: 'block' }}>{money(Math.round(Number(mainSelected?.totalSaving || 0) * 100))}</strong></div>
            </div>
        </section>

        {portfolio.emailActivities?.length > 0 && <section style={styles.card}>
            <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Recent email activity</h2>
            <p style={{ ...styles.secondary, marginTop: '-2px' }}>Saving and investment emails identified by the AI agent.</p>
            {portfolio.emailActivities.map((activity) => {
                const applied = Boolean(activity.kind);
                const withdrawal = activity.kind === 'EMAIL_WITHDRAWAL';
                const action = activity.kind?.replace('EMAIL_', '').toLowerCase();
                return <div key={activity.sourceTransactionId} style={{ ...styles.row, borderTop: '1px solid var(--Bc-4)', padding: '11px 0' }}>
                    <div style={{ minWidth: 0 }}>
                        <strong style={{ fontSize: '.9rem' }}>{activity.reason || activity.label}</strong>
                        <div style={styles.secondary}>
                            {applied
                                ? `AI identified ${action} · applied to ${activity.accountName}`
                                : 'AI identified investment activity · account match needs review'}
                        </div>
                        <div style={styles.secondary}>{new Date(activity.occurredAt).toLocaleString()} {activity.referenceNumber ? `· Ref ${activity.referenceNumber}` : ''}</div>
                    </div>
                    <strong style={{ color: applied ? 'var(--Fc-1)' : 'var(--Ac-2)', whiteSpace: 'nowrap' }}>
                        {applied ? withdrawal ? '-' : '+' : ''}{money(activity.amountMinor, activity.currency || 'USD')}
                    </strong>
                </div>;
            })}
        </section>}

        {showForm && <form onSubmit={addAccount} style={styles.card}>
            <h2 style={{ fontSize: '1rem', marginTop: 0 }}>New account</h2>
            <p style={styles.secondary}>Use the name and institution shown in its emails so automatic deposits can be matched safely.</p>
            <div style={styles.grid}>
                <input aria-label='Account name' placeholder='Emergency fund' value={account.name} onChange={(event) => setAccount({ ...account, name: event.target.value })} style={styles.field} maxLength='120' required />
                <input aria-label='Institution' placeholder='Institution (optional)' value={account.institution} onChange={(event) => setAccount({ ...account, institution: event.target.value })} style={styles.field} maxLength='120' />
                <select aria-label='Account type' value={account.accountType} onChange={(event) => setAccount({ ...account, accountType: event.target.value })} style={styles.field}>{accountTypes.map((type) => <option key={type}>{type}</option>)}</select>
                <input aria-label='Starting cash balance' type='number' min='0' step='0.01' placeholder='Cash balance' value={account.cash} onChange={(event) => setAccount({ ...account, cash: event.target.value })} style={styles.field} />
                <input aria-label='Currency' value={account.currency} onChange={(event) => setAccount({ ...account, currency: event.target.value.toUpperCase() })} style={styles.field} minLength='3' maxLength='3' required />
            </div>
            <button type='submit' style={{ ...styles.button, marginTop: '10px' }}>Create account</button>
        </form>}

        {portfolio.accounts.length ? portfolio.accounts.map((item) => <AccountCard key={item.id} account={item} onRefresh={load} setStatus={setStatus} />) :
            <section style={styles.card}><h2 style={{ fontSize: '1rem', marginTop: 0 }}>No accounts yet</h2><p style={styles.secondary}>Add a savings or investment account. Each account can hold only cash, only stocks, or both.</p></section>}
    </main>;
};

export default SaveInvest;
