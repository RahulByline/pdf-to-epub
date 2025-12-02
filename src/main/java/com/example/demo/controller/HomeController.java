package com.example.demo.controller;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;

@Controller
public class HomeController {

    @GetMapping("/")
    public String home() {
        return "index";
    }
    
    @GetMapping("/hello")
    public String hello() {
        return "hello";
    }
    
    @GetMapping("/upload")
    public String upload() {
        return "upload";
    }
    
    @GetMapping("/pdfs")
    public String pdfs() {
        return "pdfs";
    }
    
    @GetMapping("/conversions")
    public String conversions() {
        return "conversions";
    }
    
    @GetMapping("/audio-sync/{jobId}")
    public String audioSync(@PathVariable Long jobId) {
        return "audio-sync-visual";
    }
}
