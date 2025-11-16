import React, { useState, useEffect, useMemo } from 'react';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth'; // Single import for all auth funcs
import { getFirestore, doc, setDoc, collection, query, onSnapshot, serverTimestamp, updateDoc, deleteDoc } from 'firebase/firestore';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend } from 'recharts';
import { FileUp, TrendingUp, DollarSign, Wallet, CheckCircle, AlertTriangle, Trash2, Edit, Bitcoin, UserCheck, Shield, FileText, Building2, Users } from 'lucide-react'; // Added FileText for filing, Building2/Users for org/personal
import { appId, initialAuthToken, db, auth } from './config';
import { handleFileChange } from './services/ai';
import { generatePdf } from './services/pdf';
import MetricCard from './components/MetricCard';
import ReviewModal from './components/ReviewModal';
import LoginModal from './components/LoginModal';
// No duplicate onAuthStateChanged import here

const Home = () => {
  
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [records, setRecords] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isProcessingAI, setIsProcessingAI] = useState(false);
    const [error, setError] = useState(null);
    const [modal, setModal] = useState({ isOpen: false, data: null, isNew: true, id: null });
    const [loginModalOpen, setLoginModalOpen] = useState(!userId); // Open if no user
    const [email, setEmail] = useState('Anonymous'); // For user display
    const [businessType, setBusinessType] = useState('personal'); // 'personal' or 'organization'
    const [invoices, setInvoices] = useState([]); // For eTIMS generated invoices
    const [isFiling, setIsFiling] = useState(false); // Loading for filing

    // 1. Firebase Authentication
   useEffect(() => {
    if (!auth) {
        console.error("Firebase not initialized.");
        setIsAuthReady(true);
        return;
    }

    const unsubscribe = onAuthStateChanged(auth, (user) => {
        if (user) {
            setUserId(user.uid);
            setEmail(user.email || 'Anonymous'); // For display
            setLoginModalOpen(false); // Close on success
        } else {
            setUserId(null);
            setLoginModalOpen(true); // Show login
        }
        setIsAuthReady(true);
    });

    return () => unsubscribe();
}, []);

    // 2. Firestore Listener for Records
    useEffect(() => {
        if (isAuthReady && userId && db) {
            const collectionPath = `/artifacts/${appId}/users/${userId}/tax_records`;
            const recordsQuery = query(collection(db, collectionPath));

            const unsubscribe = onSnapshot(recordsQuery, (snapshot) => {
                const fetchedRecords = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data(),
                }));
                setRecords(fetchedRecords);
                setIsLoading(false);
            }, (err) => {
                console.error("Firestore listen error:", err);
                setError("Could not load financial records.");
            });

            return () => unsubscribe();
        } else if (isAuthReady) {
            setIsLoading(false);
        }
    }, [isAuthReady, userId]);

    // 3. Firestore Listener for eTIMS Invoices (New collection)
    useEffect(() => {
        if (isAuthReady && userId && db) {
            const invoicesPath = `/artifacts/${appId}/users/${userId}/etims_invoices`;
            const invoicesQuery = query(collection(db, invoicesPath));

            const unsubscribe = onSnapshot(invoicesQuery, (snapshot) => {
                const fetchedInvoices = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data(),
                }));
                setInvoices(fetchedInvoices);
            }, (err) => {
                console.error("Firestore invoices error:", err);
            });

            return () => unsubscribe();
        }
    }, [isAuthReady, userId]);

    // 4. Load/Save Business Type from Firestore (Fixed path: user doc holds profile)
    useEffect(() => {
        if (isAuthReady && userId && db) {
            const userRef = doc(db, `/artifacts/${appId}/users/${userId}`);
            const unsubscribe = onSnapshot(userRef, (docSnap) => {
                if (docSnap.exists()) {
                    setBusinessType(docSnap.data().businessType || 'personal');
                }
            });
            return () => unsubscribe();
        }
    }, [isAuthReady, userId]);

    const saveBusinessType = async (type) => {
        if (!db || !userId) return;
        try {
            const userRef = doc(db, `/artifacts/${appId}/users/${userId}`);
            await setDoc(userRef, {
                businessType: type,
                updatedAt: serverTimestamp()
            }, { merge: true });
            setBusinessType(type);
        } catch (e) {
            console.error("Profile save error:", e);
        }
    };

    // 3. Enhanced Dashboard Calculations (Added corp tax for organizations)
    const { incomeTotal, expenseTotal, vatIn, vatOut, vatPayable, investmentTotal, realizedGains, estimatedCGT, estimatedPAYE, estimatedCorpTax, netProfit, incomeData, expenseData, investmentData, auditRisks, auditScore } = useMemo(() => {
        const incomeTotal = records.filter(r => r.type === 'Income').reduce((sum, r) => sum + r.totalAmount, 0);
        const expenseTotal = records.filter(r => r.type === 'Expense').reduce((sum, r) => sum + r.totalAmount, 0);
        const netProfit = incomeTotal - expenseTotal; // Simplified annual taxable income draft (excludes CGT)

        const vatIn = records.filter(r => r.type === 'Expense').reduce((sum, r) => sum + r.vatAmount, 0);
        const vatOut = records.filter(r => r.type === 'Income').reduce((sum, r) => sum + r.vatAmount, 0);
        const vatPayable = vatOut - vatIn;

        // Investment calcs: Track buys/sells, compute realized gains (sell - buy for paired trades; simplified FIFO here)
        let buys = records.filter(r => r.type === 'Investment' && r.subType === 'Buy');
        let sells = records.filter(r => r.type === 'Investment' && r.subType === 'Sell');
        let investmentTotal = buys.reduce((sum, r) => sum + r.totalAmount, 0) + sells.reduce((sum, r) => sum + r.totalAmount, 0);
        let realizedGains = 0;
        // Simple FIFO pairing (in prod, use a proper queue)
        for (let i = 0; i < sells.length && i < buys.length; i++) {
            realizedGains += sells[i].totalAmount - buys[i].totalAmount; // Assumes paired by date order
        }
        const estimatedCGT = Math.max(0, realizedGains * 0.15); // 15% CGT for Kenya residents per KRA

        // PAYE for personal (KRA 2025 bands)
        const calculatePAYE = (annualIncome) => {
            if (annualIncome <= 0) return 0;
            let tax = 0;
            let income = annualIncome;
            // Band 1: 0 - 288,000 @ 10%
            if (income > 288000) {
                tax += 288000 * 0.10;
                income -= 288000;
            } else {
                return income * 0.10;
            }
            // Band 2: 288,001 - 388,000 @ 25%
            if (income > 100000) {
                tax += 100000 * 0.25;
                income -= 100000;
            } else {
                tax += income * 0.25;
                return tax;
            }
            // Band 3: 388,001 - 6,000,000 @ 30%
            const band3Limit = 5612000;
            if (income > band3Limit) {
                tax += band3Limit * 0.30;
                income -= band3Limit;
            } else {
                tax += income * 0.30;
                return tax;
            }
            // Band 4: 6,000,001 - 9,600,000 @ 32.5%
            const band4Limit = 3600000;
            if (income > band4Limit) {
                tax += band4Limit * 0.325;
                income -= band4Limit;
            } else {
                tax += income * 0.325;
                return tax;
            }
            // Band 5: > 9,600,000 @ 35%
            tax += income * 0.35;
            // Personal relief: KES 28,800 annual
            return Math.max(0, tax - 28800);
        };
        const estimatedPAYE = calculatePAYE(Math.max(0, netProfit));

        // Corp Tax for organizations: 30% flat on net profit (KRA 2025)
        const estimatedCorpTax = businessType === 'organization' ? Math.max(0, netProfit * 0.30) : 0;

        const categories = {
            'Income': 0,
            'Operating Expense': 0,
            'Capital Purchase': 0,
            'Other Expense': 0,
            'Investments': investmentTotal,
        };

        records.forEach(r => {
            if (r.type === 'Income') {
                categories['Income'] += r.totalAmount;
            } else if (r.type === 'Investment') {
                // Investments already tallied
            } else {
                const category = r.totalAmount > 10000 ? 'Capital Purchase' : (r.vendor.toLowerCase().includes('fuel') || r.vendor.toLowerCase().includes('transport') ? 'Operating Expense' : 'Other Expense');
                categories[category] += r.totalAmount;
            }
        });

        const incomeData = [{ name: 'Income', value: categories['Income'], color: '#10b981' }];
        const expenseData = [
            { name: 'Operating Expense', value: categories['Operating Expense'], color: '#3b82f6' },
            { name: 'Capital Purchase', value: categories['Capital Purchase'], color: '#f59e0b' },
            { name: 'Other Expense', value: categories['Other Expense'], color: '#ef4444' },
        ].filter(d => d.value > 0);
        const investmentData = [{ name: 'Investments', value: categories['Investments'], color: '#f59e0b' }];

        // KRA Audit Simulation (Based on 2025 red flags: inconsistencies, high ratios, missing data, etc.)
        const auditRisks = [];
        let auditScore = 0; // 0-100; low <30, med 30-70, high >70

        if (records.length === 0) {
            auditRisks.push({ id: 'no-records', message: 'No records uploaded: Triggers audit for non-filers or NIL returns.', severity: 'high', fix: 'Upload at least 3-5 receipts to build a compliant history.' });
            auditScore += 40;
        }
        if (expenseTotal > incomeTotal * 1.5) { // Tighter than previous 2x for audit flag
            auditRisks.push({ id: 'high-expenses', message: 'Expenses exceed 150% of income: Common red flag for lifestyle mismatch.', severity: 'high', fix: 'Verify business purpose of large expenses; categorize properly.' });
            auditScore += 30;
        }
        if (incomeTotal > 0 && vatOut / incomeTotal < 0.14) { // Slightly under 16% to flag
            auditRisks.push({ id: 'low-vat', message: 'VAT on income below 14%: May indicate under-charging or misclassification.', severity: 'medium', fix: 'Ensure all sales include 16% VAT; review income records.' });
            auditScore += 20;
        }
        const capitalPurchases = records.filter(r => r.totalAmount > 10000 && r.type === 'Expense').length;
        if (capitalPurchases > records.filter(r => r.type === 'Income').length * 0.5) {
            auditRisks.push({ id: 'high-capital', message: 'High capital purchases relative to income: Flags potential personal use.', severity: 'medium', fix: 'Document business use with quotes/invoices.' });
            auditScore += 15;
        }
        if (sells.length > 0 && buys.length < sells.length) {
            auditRisks.push({ id: 'unmatched-invest', message: 'Unmatched investment sells: CGT calculation incomplete; data discrepancy risk.', severity: 'high', fix: 'Upload buy receipts to pair trades for FIFO.' });
            auditScore += 25;
        }
        if (netProfit > 500000 && (estimatedPAYE > 100000 || estimatedCorpTax > 100000)) {
            auditRisks.push({ id: 'high-paye', message: 'High tax liability without evident deductions: Bracket creep audit trigger.', severity: 'low', fix: 'Track allowable deductions like pension/NSSF contributions.' });
            auditScore += 10;
        }
        // Cap score
        auditScore = Math.min(auditScore, 100);

        return { incomeTotal, expenseTotal, vatIn, vatOut, vatPayable, investmentTotal, realizedGains, estimatedCGT, estimatedPAYE, estimatedCorpTax, netProfit, incomeData, expenseData, investmentData, auditRisks, auditScore };
    }, [records, businessType]);

    const handleAuthSuccess = () => {
    setLoginModalOpen(false);
    setIsLoading(true); // Refresh records
      };

    // 4. Enhanced File Upload and AI Processing (Suggest Investment type on crypto keywords)
      const onFileChange = async (event) => {
          const file = event.target.files[0];
          if (!file || !db || !userId) {
              setError("Please log in and select a file.");
              return;
          }

          setIsProcessingAI(true);
          setError(null);

          try {
              handleFileChange(file, (aiData) => {
                  // Detect crypto/investment keywords for suggestion (per KRA: crypto gains under CGT)
                  const textLower = (aiData.description || aiData.vendor || '').toLowerCase();
                  const isInvestment = textLower.includes('btc') || textLower.includes('eth') || textLower.includes('bitcoin') || textLower.includes('crypto') || textLower.includes('trade') || textLower.includes('sell') || textLower.includes('buy');
                  const suggestedType = isInvestment ? 'Investment' : (aiData.type || 'Expense');
                  const suggestedSubType = isInvestment && textLower.includes('sell') ? 'Sell' : (isInvestment ? 'Buy' : null);

                  setModal({
                      isOpen: true,
                      data: {
                          ...aiData,
                          type: suggestedType,
                          subType: suggestedSubType,
                          timestamp: serverTimestamp(),
                          userId: userId,
                          totalAmount: parseFloat(aiData.totalAmount || 0),
                          vatAmount: parseFloat(aiData.vatAmount || 0),
                      },
                      isNew: true,
                      id: null
                  });
              }, (errMsg) => {
                  setError(`Failed to process image. Make sure the image is clear. (${errMsg})`);
              });
          } catch (e) {
              console.error("AI or File Error:", e);
              setError(`Failed to process image. Make sure the image is clear. (${e.message})`);
          } finally {
              setIsProcessingAI(false); // Now waits for async
              event.target.value = null;
          }
      };

    // 5. CRUD Operations (Unchanged)
    const saveRecord = async (data, id, isNew) => {
        if (!db || !userId) {
            setError("Database connection missing.");
            return;
        }
        setIsLoading(true);
        const recordRef = doc(db, `/artifacts/${appId}/users/${userId}/tax_records`, isNew ? data.id || crypto.randomUUID() : id);

        try {
            if (isNew) {
                await setDoc(recordRef, {
                    ...data,
                    timestamp: serverTimestamp(),
                    id: recordRef.id
                });
            } else {
                await updateDoc(recordRef, data);
            }
            setModal({ isOpen: false, data: null, isNew: true, id: null });
        } catch (e) {
            console.error("Save Error:", e);
            setError("Failed to save record to database.");
        } finally {
            setIsLoading(false);
        }
    };

    const deleteRecord = async (id) => {
        if (window.confirm("Are you sure you want to delete this record?")) {
            if (!db || !userId) return;
            setIsLoading(true);
            try {
                await deleteDoc(doc(db, `/artifacts/${appId}/users/${userId}/tax_records`, id));
            } catch (e) {
                console.error("Delete Error:", e);
                setError("Failed to delete record.");
            } finally {
                setIsLoading(false);
            }
        }
    };

    const openEditModal = (record) => {
        setModal({
            isOpen: true,
            data: {
                ...record,
                date: record.date || new Date().toISOString().substring(0, 10),
                totalAmount: record.totalAmount,
                vatAmount: record.vatAmount,
            },
            isNew: false,
            id: record.id
        });
    };

    // New: Mock GavaConnect API for Filing Returns (In prod: Use server-side for tokens; integrate via https://developer.go.ke/apis)
    const fileReturn = async (returnType) => {
        if (records.length === 0) {
            setError('No data available for filing. Upload records first.');
            return;
        }
        setIsFiling(true);
        try {
            // Mock auth token (replace with real OAuth/Bearer from GavaConnect)
            const mockToken = 'Bearer your_gavaconnect_token'; // Fetch from backend
            const returnData = {
                taxpayerPin: 'mock_pin', // From user profile
                period: new Date().getFullYear(), // Annual, adjust for quarterly
                type: returnType, // 'VAT', 'PAYE', etc.
                amount: returnType === 'VAT' ? vatPayable : (returnType === 'PAYE' ? estimatedPAYE : estimatedCorpTax),
                records: records, // Anonymized summary
            };
            // Mock API call (prod: POST to /api/returns/{type} on GavaConnect)
            console.log(`Filing ${returnType} return:`, returnData);
            // Simulate success
            await new Promise(resolve => setTimeout(resolve, 2000));
            alert(`${returnType} return filed successfully via iTax/GavaConnect! Reference: MOCK-${Date.now()}`);
            // Optional: Generate PDF
            if (returnType === 'VAT') generatePdf(records, vatPayable);
        } catch (e) {
            console.error('Filing error:', e);
            setError(`Failed to file ${returnType} return. Check connection to KRA APIs.`);
        } finally {
            setIsFiling(false);
        }
    };

    // New: Generate eTIMS Invoice (From income records; mock VSCU/OSCU integration)
    const generateETIMSInvoice = async (record) => {
        if (!record || record.type !== 'Income') {
            setError('Only income records can generate e-invoices.');
            return;
        }
        setIsLoading(true);
        try {
            // Mock eTIMS API (prod: POST to etims-sbx.kra.go.ke/v2/invoices via VSCU spec)
            const invoiceData = {
                invoiceId: crypto.randomUUID(),
                pin: 'mock_pin',
                buyerPin: 'buyer_mock_pin', // From modal input
                amount: record.totalAmount,
                vat: record.vatAmount,
                date: record.date,
                description: record.description || 'Service/Goods',
            };
            console.log('Generating eTIMS invoice:', invoiceData);
            // Simulate
            await new Promise(resolve => setTimeout(resolve, 1000));
            const newInvoice = { ...invoiceData, status: 'Issued', timestamp: serverTimestamp() };
            await setDoc(doc(db, `/artifacts/${appId}/users/${userId}/etims_invoices`, newInvoice.invoiceId), newInvoice);
            alert('eTIMS invoice generated and issued! QR/Validation ready.');
        } catch (e) {
            console.error('eTIMS error:', e);
            setError('Failed to generate e-invoice. Ensure eTIMS integration is certified.');
        } finally {
            setIsLoading(false);
        }
    };

    // New: Preview Schedule CG (Mock for now; integrate with PDF gen later)
    const previewScheduleCG = () => {
        if (realizedGains <= 0) {
            alert('No realized gains to report yet.');
            return;
        }
        console.log('Schedule CG Preview:', {
            realizedGains,
            estimatedCGT,
            records: records.filter(r => r.type === 'Investment')
        });
        // In prod: Generate modal or PDF snippet
        alert(`Estimated CGT: KES ${estimatedCGT.toFixed(2)} on KES ${realizedGains.toFixed(2)} gains. Review investments for full Schedule CG.`);
    };

   if (!isAuthReady || isLoading) {
    return (
        <div className="flex justify-center items-center h-screen bg-gray-50">
            <div className="text-xl font-semibold text-indigo-600">Loading TaxMate AI...</div>
        </div>
    );
}

if (!userId) {
    return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
            <LoginModal
                isOpen={loginModalOpen}
                onClose={() => setLoginModalOpen(false)}
                onSuccess={handleAuthSuccess}
            />
        </div>
    );
}



    return (
        <div className="min-h-screen bg-gray-50 p-4 sm:p-8 font-inter">
            <style>{`
                .font-inter { font-family: 'Inter', sans-serif; }
                .chart-container { height: 250px; }
            `}</style>

            {/* Header */}
            <header className="flex justify-between items-center mb-8 border-b pb-4">
                <div>
                    <h1 className="text-4xl font-extrabold text-indigo-700 tracking-tight">
                        TaxMate AI 🇰🇪
                    </h1>
                    <p className="text-lg text-gray-600 mt-1">
                        All-in-One Tax Management: Personal & Business. eTIMS & iTax Integrated.
                    </p>
                    <div className="mt-2 text-sm text-gray-400">
                        User: {email} | <span className={`font-semibold ${businessType === 'personal' ? 'text-blue-600' : 'text-green-600'}`}>
                            {businessType === 'personal' ? 'Personal' : 'Organization'}
                        </span>
                    </div>
                </div>
                <div className="flex items-center space-x-2">
                    <select 
                        value={businessType} 
                        onChange={(e) => saveBusinessType(e.target.value)}
                        className="text-sm border rounded px-2 py-1"
                    >
                        <option value="personal">Personal</option>
                        <option value="organization">Organization</option>
                    </select>
                    <button
                        onClick={() => auth.signOut()}
                        className="text-sm text-gray-500 hover:text-red-500"
                    >
                        Logout
                    </button>
                </div>
            </header>

            {/* Error Display */}
            {error && (
                <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-xl mb-4" role="alert">
                    <strong className="font-bold">Error:</strong>
                    <span className="block sm:inline ml-2">{error}</span>
                </div>
            )}

            {/* Action Card: Upload */}
            <div className="mb-8 bg-white shadow-xl rounded-2xl p-6 border border-indigo-200">
                <h2 className="text-2xl font-bold text-gray-800 mb-4 flex items-center">
                    <FileUp className="w-6 h-6 mr-2 text-indigo-500" />
                    Step 1: Upload Receipt / Invoice
                </h2>
                <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-indigo-300 border-dashed rounded-xl cursor-pointer bg-indigo-50 hover:bg-indigo-100 transition duration-300">
    {isProcessingAI ? (
        <div className="text-indigo-600 font-semibold flex items-center">
            <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-indigo-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span className="processing-text">Processing Receipt</span> {/* No placeholder */}
        </div>
    ) : (
        <>
            <p className="mb-2 text-sm text-gray-600 font-medium">
                Click or drag photo (of crumpled receipt!)
            </p>
            <p className="text-xs text-gray-500">
                Image only. AI will extract data.
            </p>
        </>
    )}
    <input type="file" className="hidden" accept="image/*" onChange={onFileChange} disabled={isProcessingAI} />
</label>
            </div>

           {/* Dashboard and Alerts */}
            <div className="grid grid-cols-1 gap-6 mb-8 max-w-4xl mx-auto"> {/* Single column, centered container for PC */}
                {/* Metrics - Stacked vertically at top, Added corp tax card */}
                <div className="space-y-6">
                    <h2 className="text-2xl font-bold text-gray-800 mb-2 flex items-center">
                        <TrendingUp className="w-6 h-6 mr-2 text-green-500" />
                        Step 2 & 3: Real-Time Dashboard (KRA 2025 Compliant Drafts)
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"> {/* Adjusted grid for more cards */}
                        <MetricCard title="Total Income" value={incomeTotal} icon={DollarSign} color="text-green-600" />
                        <MetricCard title="Total Expenses" value={expenseTotal} icon={Wallet} color="text-red-600" />
                        <MetricCard title="Net Profit (Draft)" value={netProfit} icon={TrendingUp} color={netProfit > 0 ? "text-green-600" : "text-red-600"} />
                        {businessType === 'personal' ? (
                            <MetricCard title="Est. PAYE Liability" value={estimatedPAYE} icon={UserCheck} color="text-blue-600" />
                        ) : (
                            <MetricCard title="Est. Corp Tax (30%)" value={estimatedCorpTax} icon={Building2} color="text-purple-600" />
                        )}
                        {investmentTotal > 0 && (
                            <MetricCard title="Est. CGT Liability" value={estimatedCGT} icon={Bitcoin} color="text-orange-600" />
                        )}
                    </div>
                </div>

                {/* VAT Card - Next in vertical flow */}
                <div className="bg-white shadow-xl rounded-2xl p-6 border border-yellow-200">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-xl font-bold text-gray-800">VAT Compliance Status (16% Standard Rate)</h3>
                        <button
                            onClick={() => generatePdf(records, vatPayable)}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-xl shadow-lg transition duration-300 transform hover:scale-105"
                            disabled={records.length === 0}
                        >
                            Step 4: Generate Tax Draft PDF
                        </button>
                    </div>

                    <div className="grid grid-cols-2 gap-4 text-center border-t pt-4">
                        <div>
                            <p className="text-sm text-gray-500">VAT Collected (Out)</p>
                            <p className="text-2xl font-bold text-indigo-600">
                                KES {vatOut.toFixed(2)}
                            </p>
                        </div>
                        <div>
                            <p className="text-sm text-gray-500">VAT Claimable (In)</p>
                            <p className="text-2xl font-bold text-indigo-600">
                                KES {vatIn.toFixed(2)}
                            </p>
                        </div>
                    </div>

                    <div className={`mt-4 p-3 rounded-xl ${vatPayable >= 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'} font-bold text-center`}>
                        <p className="text-sm">NET VAT PAYABLE TO KRA (Draft)</p>
                        <p className="text-3xl mt-1">
                            KES {vatPayable.toFixed(2)}
                        </p>
                    </div>
                </div>

                {/* New: File Returns Section (iTax/GavaConnect Integration) */}
                <div className="bg-white shadow-xl rounded-2xl p-6 border border-indigo-200">
                    <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center">
                        <FileText className="w-5 h-5 mr-2 text-indigo-500" />
                        File Returns via iTax (GavaConnect API)
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <button
                            onClick={() => fileReturn('VAT')}
                            disabled={isFiling || records.length === 0}
                            className="bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-3 px-4 rounded-xl shadow-lg transition duration-300 flex items-center justify-center space-x-2 disabled:opacity-50"
                        >
                            <FileText className="w-4 h-4" />
                            <span>File VAT</span>
                        </button>
                        <button
                            onClick={() => fileReturn(businessType === 'personal' ? 'PAYE' : 'CorpIT')}
                            disabled={isFiling || records.length === 0}
                            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-xl shadow-lg transition duration-300 flex items-center justify-center space-x-2 disabled:opacity-50"
                        >
                            {businessType === 'personal' ? <UserCheck className="w-4 h-4" /> : <Building2 className="w-4 h-4" />}
                            <span>{businessType === 'personal' ? 'File PAYE' : 'File Corp IT'}</span>
                        </button>
                        {investmentTotal > 0 && (
                            <button
                                onClick={() => fileReturn('CGT')}
                                disabled={isFiling || realizedGains <= 0}
                                className="bg-orange-600 hover:bg-orange-700 text-white font-bold py-3 px-4 rounded-xl shadow-lg transition duration-300 flex items-center justify-center space-x-2 disabled:opacity-50"
                            >
                                <Bitcoin className="w-4 h-4" />
                                <span>File CGT</span>
                            </button>
                        )}
                    </div>
                    {isFiling && <p className="text-center text-indigo-600 mt-4">Filing in progress... Connecting to KRA GavaConnect.</p>}
                    <p className="text-xs text-gray-500 mt-4 text-center">Mock integration; prod uses OAuth Bearer tokens via backend for security. Certify with KRA developer portal.</p>
                </div>

                {/* New: eTIMS Invoices Section */}
                <div className="bg-white shadow-xl rounded-2xl p-6 border border-green-200">
                    <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center">
                        <FileText className="w-5 h-5 mr-2 text-green-500" />
                        eTIMS Compliant Invoices ({invoices.length})
                    </h3>
                    <div className="grid grid-cols-1 gap-4 mb-4">
                        {records.filter(r => r.type === 'Income').map((record) => (
                            <button
                                key={record.id}
                                onClick={() => generateETIMSInvoice(record)}
                                disabled={isLoading}
                                className="bg-green-600 hover:bg-green-700 text-white py-2 px-4 rounded-lg transition duration-300 flex items-center justify-center space-x-2 disabled:opacity-50"
                            >
                                <FileText className="w-4 h-4" />
                                <span>Issue eTIMS for {record.vendor} (KES {record.totalAmount.toFixed(2)})</span>
                            </button>
                        ))}
                    </div>
                    {invoices.length > 0 && (
                        <div className="text-sm text-gray-600">
                            <p>Issued Invoices: {invoices.map(inv => <span key={inv.id} className="block">ID: {inv.invoiceId} - Status: {inv.status}</span>)}</p>
                        </div>
                    )}
                    <p className="text-xs text-gray-500 mt-4 text-center">Uses VSCU/OSCU specs; test in eTIMS sandbox (etims-sbx.kra.go.ke). Certify for production.</p>
                </div>

                {/* KRA Audit Simulation Card */}
                <div className="bg-white shadow-xl rounded-2xl p-6 border border-purple-200">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-xl font-bold text-gray-800 flex items-center">
                            <Shield className="w-5 h-5 mr-2 text-purple-500" />
                            KRA Audit Risk Simulation (2025 Triggers)
                        </h3>
                        <div className={`px-3 py-1 rounded-full text-sm font-bold ${
                            auditScore < 30 ? 'bg-green-100 text-green-800' :
                            auditScore < 70 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'
                        }`}>
                            Risk Score: {auditScore}/100
                        </div>
                    </div>
                    {auditRisks.length === 0 ? (
                        <p className="text-green-600 text-center italic">No major red flags detected! Low audit risk.</p>
                    ) : (
                        <div className="space-y-3">
                            {auditRisks.map((risk) => (
                                <div key={risk.id} className={`p-3 rounded-lg border-l-4 ${
                                    risk.severity === 'high' ? 'bg-red-50 border-red-400' :
                                    risk.severity === 'medium' ? 'bg-yellow-50 border-yellow-400' : 'bg-blue-50 border-blue-400'
                                }`}>
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <p className="font-semibold text-gray-800">{risk.message}</p>
                                            <p className={`text-sm mt-1 ${risk.severity === 'high' ? 'text-red-600' : risk.severity === 'medium' ? 'text-yellow-600' : 'text-blue-600'}`}>
                                                Severity: {risk.severity.toUpperCase()}
                                            </p>
                                        </div>
                                        <span className={`text-xs px-2 py-1 rounded-full ${
                                            risk.severity === 'high' ? 'bg-red-200 text-red-800' :
                                            risk.severity === 'medium' ? 'bg-yellow-200 text-yellow-800' : 'bg-blue-200 text-blue-800'
                                        }`}>
                                            {risk.severity.charAt(0).toUpperCase() + risk.severity.slice(1)}
                                        </span>
                                    </div>
                                    <p className="text-sm text-gray-600 mt-2 italic">{risk.fix}</p>
                                </div>
                            ))}
                        </div>
                    )}
                    <p className="text-xs text-gray-500 mt-4 text-center">Simulation based on common KRA triggers like data discrepancies and ratios. Not official advice.</p>
                </div>

                {/* Investment Preview Button (if applicable) */}
                {investmentTotal > 0 && (
                    <div className="bg-white shadow-xl rounded-2xl p-6 border border-orange-200 text-center">
                        <button
                            onClick={previewScheduleCG}
                            className="bg-orange-600 hover:bg-orange-700 text-white font-bold py-2 px-6 rounded-xl shadow-lg transition duration-300 flex items-center justify-center mx-auto"
                        >
                            <Bitcoin className="w-4 h-4 mr-2" />
                            Preview Schedule CG (Capital Gains, 15% Rate)
                        </button>
                        <p className="text-sm text-gray-600 mt-2">Based on {records.filter(r => r.type === 'Investment').length} trades. Crypto gains taxed at CGT (excise on platform fees separate).</p>
                    </div>
                )}

                {/* Simple Insight/Alerts - Enhanced with PAYE bracket advice */}
                <div className="bg-white shadow-xl rounded-2xl p-4 border border-red-200">
                    <h3 className="text-lg font-semibold text-gray-800 flex items-center mb-2">
                        <AlertTriangle className="w-5 h-5 mr-2 text-red-500" />
                        KRA Compliance Alerts (2025 Regulations)
                    </h3>
                    <ul className="text-sm space-y-1">
                        {records.length === 0 && (
                            <li className="text-red-600">
                                <span className="font-bold">CRITICAL:</span> No records found. Start uploading invoices and receipts!
                            </li>
                        )}
                        {expenseTotal > incomeTotal * 2 && (
                            <li className="text-red-600">
                                <span className="font-bold">RISK:</span> Your expenses significantly exceed income. KRA may flag this return for review.
                            </li>
                        )}
                        {incomeTotal > 0 && vatOut / incomeTotal < 0.16 && (
                            <li className="text-yellow-600">
                                <span className="font-bold">ADVICE:</span> The calculated VAT on sales (VAT Out) is less than 16% of your income. Check if all sales invoices correctly charged 16% VAT.
                            </li>
                        )}
                        {realizedGains > investmentTotal * 0.2 && (
                            <li className="text-red-600">
                                <span className="font-bold">RISK:</span> Realized gains exceed 20% of investment volume. High CGT exposure (15%)—consider holding longer to defer tax.
                            </li>
                        )}
                        {netProfit > 9600000 && (
                            <li className="text-red-600">
                                <span className="font-bold">HIGH BRACKET:</span> Estimated income pushes you into 35% PAYE band. Optimize deductions with a tax advisor.
                            </li>
                        )}
                        {records.length > 5 && (
                            <li className="text-green-600 flex items-center">
                                <CheckCircle className="w-4 h-4 mr-1" />
                                Digital Record Clean! Ready for accountant review. All calcs are drafts—consult KRA guidelines.
                            </li>
                        )}
                    </ul>
                </div>

                {/* Pie Chart / Visuals - Enhanced with investments */}
                <div className="bg-white shadow-xl rounded-2xl p-6 border border-gray-200 mx-auto max-w-md"> {/* Centered with max-width */}
                    <h3 className="text-xl font-bold text-gray-800 mb-4 text-center">Financial Snapshot</h3>

                    {records.length > 0 ? (
                        <div className="chart-container mx-auto"> {/* Extra centering */}
                            <ResponsiveContainer width="100%" height={250}>
                                <PieChart>
                                    <Pie
                                        data={incomeData.concat(expenseData).concat(investmentData.filter(d => d.value > 0))}
                                        dataKey="value"
                                        nameKey="name"
                                        cx="50%"
                                        cy="50%"
                                        outerRadius={80}
                                        fill="#8884d8"
                                        labelLine={false}
                                        label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                                    >
                                        {incomeData.concat(expenseData).concat(investmentData.filter(d => d.value > 0)).map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={entry.color} />
                                        ))}
                                    </Pie>
                                    <Legend layout="horizontal" align="center" verticalAlign="bottom" />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                        <div className="h-48 flex justify-center items-center text-gray-500 text-center">
                            Upload a receipt to view chart.
                        </div>
                    )}
                </div>
            </div>

            {/* Transaction List - Enhanced to show subType for Investments */}
            <div className="bg-white shadow-xl rounded-2xl p-6 border border-gray-200">
                <h2 className="text-2xl font-bold text-gray-800 mb-4">Clean Digital Record ({records.length} items)</h2>
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Vendor</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Total (KES)</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">VAT (KES)</th>
                                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {records.map((record) => (
                                <tr key={record.id} className={record.type === 'Income' ? 'bg-green-50' : record.type === 'Investment' ? 'bg-orange-50' : 'hover:bg-gray-50'}>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                        {record.type} {record.subType ? `(${record.subType})` : ''}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                                        {record.vendor}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                                        {record.date}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-semibold text-gray-900">
                                        {record.totalAmount.toFixed(2)}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-600">
                                        {record.vatAmount.toFixed(2)}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-center text-sm font-medium space-x-2">
                                        <button onClick={() => openEditModal(record)} className="text-indigo-600 hover:text-indigo-900 p-1 rounded-full hover:bg-indigo-100 transition"><Edit className="w-4 h-4" /></button>
                                        <button onClick={() => deleteRecord(record.id)} className="text-red-600 hover:text-red-900 p-1 rounded-full hover:bg-red-100 transition"><Trash2 className="w-4 h-4" /></button>
                                        {record.type === 'Income' && (
                                            <button onClick={() => generateETIMSInvoice(record)} className="text-green-600 hover:text-green-900 p-1 rounded-full hover:bg-green-100 transition"><FileText className="w-4 h-4" /></button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {records.length === 0 && (
                        <div className="p-6 text-center text-gray-500 italic">
                            No records yet. Upload your first receipt/invoice to start automating!
                        </div>
                    )}
                </div>
            </div>

            {/* Edit/Review Modal */}
            {modal.isOpen && (
                <ReviewModal
                    data={modal.data}
                    isNew={modal.isNew}
                    onClose={() => setModal({ isOpen: false, data: null, isNew: true, id: null })}
                    onSave={saveRecord}
                    id={modal.id}
                />
            )}
        </div>
    );
};

export default Home;