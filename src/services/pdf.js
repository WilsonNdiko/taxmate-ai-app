// Assumes jsPDF and autoTable are global via CDN
export const generatePdf = (records, vatPayable) => {
    // @ts-ignore
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const today = new Date().toLocaleDateString('en-KE');
    const incomeTotal = records.filter(r => r.type === 'Income').reduce((sum, r) => sum + r.totalAmount, 0);
    const expenseTotal = records.filter(r => r.type === 'Expense').reduce((sum, r) => sum + r.totalAmount, 0);

    doc.setFontSize(18);
    doc.text("TaxMate AI - KRA VAT Draft Return", 14, 20);

    doc.setFontSize(10);
    doc.text(`Generated on: ${today}`, 14, 26);
    doc.text(`For: local-dev (Simulated App ID)`, 14, 31);
    doc.text(`Draft Status: UNFILED (Requires Accountant Review)`, 14, 36);

    doc.setFontSize(14);
    doc.text("1. VAT Summary (KES)", 14, 50);

    // @ts-ignore
    doc.autoTable({
        startY: 55,
        head: [['Metric', 'Amount (KES)']],
        body: [
            ['Total Taxable Sales (Income)', incomeTotal.toFixed(2)],
            ['Total Taxable Purchases (Expenses)', expenseTotal.toFixed(2)],
            ['Net VAT Payable / (Refundable)', vatPayable.toFixed(2)],
        ],
        theme: 'striped',
        styles: { fontSize: 10 }
    });

    doc.setFontSize(14);
    // @ts-ignore
    doc.text("2. Detailed Transaction Listing", 14, (doc.autoTable.previous.finalY || 70) + 10);

    // @ts-ignore
    doc.autoTable({
        // @ts-ignore
        startY: (doc.autoTable.previous.finalY || 70) + 15,
        head: [['Type', 'Vendor', 'Date', 'Total Amount', 'VAT']],
        body: records.map(r => [
            r.type,
            r.vendor,
            r.date,
            r.totalAmount.toFixed(2),
            r.vatAmount.toFixed(2),
        ]),
        theme: 'grid',
        styles: { fontSize: 8 },
    });

    doc.save(`TaxMate_Draft_${today}.pdf`);
};