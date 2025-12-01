package com.example.demo.controller;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

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
}
