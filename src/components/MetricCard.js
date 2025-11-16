import React from 'react';
import PropTypes from 'prop-types';

const MetricCard = ({ title, value, icon: Icon, color }) => (
    <div className="bg-white shadow-lg rounded-xl p-5 border border-gray-200 transition duration-300 hover:shadow-xl hover:border-indigo-300">
        <div className="flex items-center">
            <div className={`p-3 rounded-full bg-opacity-10 ${color.replace('text', 'bg')}`}>
                <Icon className={`w-6 h-6 ${color}`} />
            </div>
            <p className="ml-4 text-sm font-medium text-gray-500">{title}</p>
        </div>
        <p className="text-3xl font-extrabold text-gray-900 mt-2">
            KES {value.toFixed(2)}
        </p>
    </div>
);

MetricCard.propTypes = {
    title: PropTypes.string.isRequired,
    value: PropTypes.number.isRequired,
    icon: PropTypes.elementType.isRequired,
    color: PropTypes.string.isRequired,
};

export default MetricCard;