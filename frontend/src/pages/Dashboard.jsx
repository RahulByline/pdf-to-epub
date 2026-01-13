import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { pdfService } from '../services/pdfService';
import { conversionService } from '../services/conversionService';
import { 
  HiOutlineDocument, 
  HiOutlineRefresh,
  HiOutlineCheckCircle,
  HiOutlineClock,
  HiOutlineXCircle,
  HiOutlineCloudUpload,
  HiOutlineArrowRight
} from 'react-icons/hi';
import './Dashboard.css';

const Dashboard = () => {
  const [stats, setStats] = useState({
    totalPdfs: 0,
    totalConversions: 0,
    inProgress: 0,
    completed: 0,
    failed: 0
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    console.log('Starting dashboard data load...');
    try {
      console.log('Fetching PDFs and conversions...');
      const [pdfs, allConversions] = await Promise.all([
        pdfService.getAllPdfs(),
        conversionService.getConversionsByStatus('COMPLETED')
      ]);

      console.log('Fetching in-progress and failed conversions...');
      const inProgressJobs = await conversionService.getConversionsByStatus('IN_PROGRESS');
      const failedJobs = await conversionService.getConversionsByStatus('FAILED');

      console.log('API responses:', { pdfs, allConversions, inProgressJobs, failedJobs });

      // Ensure we have arrays before accessing length
      const pdfsArray = Array.isArray(pdfs) ? pdfs : [];
      const completedArray = Array.isArray(allConversions) ? allConversions : [];
      const inProgressArray = Array.isArray(inProgressJobs) ? inProgressJobs : [];
      const failedArray = Array.isArray(failedJobs) ? failedJobs : [];

      console.log('Array lengths:', {
        pdfs: pdfsArray.length,
        completed: completedArray.length,
        inProgress: inProgressArray.length,
        failed: failedArray.length
      });

      const totalConversions = completedArray.length + inProgressArray.length + failedArray.length;

      const newStats = {
        totalPdfs: pdfsArray.length,
        totalConversions: totalConversions,
        inProgress: inProgressArray.length,
        completed: completedArray.length,
        failed: failedArray.length
      };

      console.log('Setting stats:', newStats);
      setStats(newStats);
    } catch (error) {
      console.error('Error loading dashboard data:', error);
      console.error('Error details:', error.response || error.message);
      // Set default values on error
      setStats({
        totalPdfs: 0,
        totalConversions: 0,
        inProgress: 0,
        completed: 0,
        failed: 0
      });
    } finally {
      setLoading(false);
    }
  };

  const successRate = stats.totalConversions > 0 
    ? ((stats.completed / stats.totalConversions) * 100).toFixed(1)
    : 0;

  if (loading) {
    return <div className="loading">Loading dashboard...</div>;
  }

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <h1>Dashboard</h1>
        <p className="dashboard-subtitle">Welcome to PDF to EPUB Converter</p>
      </div>

      {/* Key Metrics Cards */}
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-icon pdf">
            <HiOutlineDocument />
          </div>
          <div className="metric-content">
            <h3>Total PDFs</h3>
            <p className="metric-value">{stats.totalPdfs}</p>
            <Link to="/pdfs" className="metric-link">View All PDFs →</Link>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-icon conversion">
            <HiOutlineRefresh />
          </div>
          <div className="metric-content">
            <h3>Total Conversions</h3>
            <p className="metric-value">{stats.totalConversions}</p>
            <Link to="/conversions" className="metric-link">View All →</Link>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-icon completed">
            <HiOutlineCheckCircle />
          </div>
          <div className="metric-content">
            <h3>Completed</h3>
            <p className="metric-value">{stats.completed}</p>
            <span className="metric-percentage">{successRate}% success rate</span>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-icon progress">
            <HiOutlineClock />
          </div>
          <div className="metric-content">
            <h3>In Progress</h3>
            <p className="metric-value">{stats.inProgress}</p>
            <span className="metric-status">Active jobs</span>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-icon failed">
            <HiOutlineXCircle />
          </div>
          <div className="metric-content">
            <h3>Failed</h3>
            <p className="metric-value">{stats.failed}</p>
            <span className="metric-status">Requires attention</span>
          </div>
        </div>
      </div>

      {/* Process Steps Section */}
      <div className="process-section">
        <h2>How It Works</h2>
        <p className="process-subtitle">Follow these simple steps to convert your PDFs to EPUB format</p>
        
        <div className="process-steps">
          <div className="process-step">
            <div className="step-number">1</div>
            <div className="step-icon">
              <HiOutlineCloudUpload />
            </div>
            <div className="step-content">
              <h3>Upload PDF</h3>
              <p>Upload your PDF file using the upload page. You can also upload multiple PDFs or a ZIP file containing multiple PDFs.</p>
              <Link to="/pdfs/upload" className="step-action">
                Go to Upload <HiOutlineArrowRight />
              </Link>
            </div>
          </div>

          <div className="step-connector">
            <HiOutlineArrowRight />
          </div>

          <div className="process-step">
            <div className="step-number">2</div>
            <div className="step-icon">
              <HiOutlineRefresh />
            </div>
            <div className="step-content">
              <h3>Start Conversion</h3>
              <p>Select a PDF from your library and start the conversion process. The system will automatically process your document.</p>
              <Link to="/pdfs" className="step-action">
                View PDFs <HiOutlineArrowRight />
              </Link>
            </div>
          </div>

          <div className="step-connector">
            <HiOutlineArrowRight />
          </div>

          <div className="process-step">
            <div className="step-number">3</div>
            <div className="step-icon">
              <HiOutlineClock />
            </div>
            <div className="step-content">
              <h3>Monitor Progress</h3>
              <p>Track the conversion progress in real-time. You can see the current step and progress percentage.</p>
              <Link to="/conversions" className="step-action">
                View Conversions <HiOutlineArrowRight />
              </Link>
            </div>
          </div>

          <div className="step-connector">
            <HiOutlineArrowRight />
          </div>

          <div className="process-step">
            <div className="step-number">4</div>
            <div className="step-icon">
              <HiOutlineCheckCircle />
            </div>
            <div className="step-content">
              <h3>Download EPUB</h3>
              <p>Once conversion is completed, download your EPUB file. You can also review and manage all your conversions.</p>
              <Link to="/conversions" className="step-action">
                Download EPUB <HiOutlineArrowRight />
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="quick-actions-section">
        <h2>Quick Actions</h2>
        <div className="action-buttons">
          <Link to="/pdfs/upload" className="btn btn-primary">
            <HiOutlineCloudUpload className="btn-icon" />
            Upload PDF
          </Link>
          <Link to="/pdfs" className="btn btn-success">
            <HiOutlineDocument className="btn-icon" />
            Manage PDFs
          </Link>
          <Link to="/conversions" className="btn btn-primary">
            <HiOutlineRefresh className="btn-icon" />
            View Conversions
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
