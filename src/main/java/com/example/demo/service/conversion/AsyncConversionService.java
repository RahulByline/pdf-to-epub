package com.example.demo.service.conversion;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

@Service
public class AsyncConversionService {

    private static final Logger logger = LoggerFactory.getLogger(AsyncConversionService.class);

    @Autowired
    @Lazy
    private ConversionOrchestrationService orchestrationService;

    @Async("conversionExecutor")
    public void startAsyncConversion(Long jobId) {
        logger.info("Async thread started for job ID: {}", jobId);
        try {
            orchestrationService.executeConversion(jobId);
        } catch (Throwable e) {
            // Catch both Exception and Error types (like java.lang.Error: Invalid memory access)
            logger.error("Error/Exception in async conversion for job {} ({}): {}", 
                        jobId, e.getClass().getSimpleName(), e.getMessage(), e);
            orchestrationService.handleConversionError(jobId, e);
        }
    }
}
