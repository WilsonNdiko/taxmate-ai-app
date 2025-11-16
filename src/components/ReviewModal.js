import React, { useState } from 'react';
import PropTypes from 'prop-types';

const ReviewModal = ({ data, isNew, onClose, onSave, id }) => {
    const [formData, setFormData] = useState(data);

    const handleChange = (e) => {
        const { name, value, type } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: type === 'number' ? parseFloat(value) || 0 : value,
        }));
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        onSave(formData, id, isNew);
    };

    return (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-70 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6">
                <h3 className="text-2xl font-bold text-indigo-700 mb-4 border-b pb-2">
                    {isNew ? 'AI Extracted Data (Review)' : 'Edit Financial Record'}
                </h3>
                <p className="text-sm text-gray-600 mb-4">
                    Please verify the data extracted by the AI before saving to your clean record.
                </p>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Vendor/Source</label>
                        <input
                            type="text"
                            name="vendor"
                            value={formData.vendor}
                            onChange={handleChange}
                            required
                            className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 p-2 border"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Transaction Date</label>
                        <input
                            type="date"
                            name="date"
                            value={formData.date ? formData.date.substring(0, 10) : new Date().toISOString().substring(0, 10)}
                            onChange={handleChange}
                            required
                            className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 p-2 border"
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Total Amount (KES)</label>
                            <input
                                type="number"
                                name="totalAmount"
                                value={formData.totalAmount}
                                onChange={handleChange}
                                required
                                min="0"
                                step="0.01"
                                className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 p-2 border"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">VAT Amount (KES)</label>
                            <input
                                type="number"
                                name="vatAmount"
                                value={formData.vatAmount}
                                onChange={handleChange}
                                required
                                min="0"
                                step="0.01"
                                className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 p-2 border"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Transaction Type</label>
                        <select
                            name="type"
                            value={formData.type}
                            onChange={handleChange}
                            required
                            className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 p-2 border bg-white"
                        >
                            <option value="Expense">Expense (Purchase/Receipt)</option>
                            <option value="Income">Income (Sale/Invoice)</option>
                        </select>
                    </div>

                    <div className="flex justify-end space-x-3 pt-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 transition"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition shadow-md"
                        >
                            {isNew ? 'Save to Digital Record' : 'Update Record'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

ReviewModal.propTypes = {
    data: PropTypes.object.isRequired,
    isNew: PropTypes.bool.isRequired,
    onClose: PropTypes.func.isRequired,
    onSave: PropTypes.func.isRequired,
    id: PropTypes.string,
};

export default ReviewModal;